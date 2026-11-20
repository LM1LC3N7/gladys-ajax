// -----------------------------------------------------------------------------
// AjaxApp with the SDK's fake Gladys (createFakeGladys), a fake channel (the
// messages the receiver would forward) and a controlled clock.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { AjaxApp } from '../src/app.js';
import { buildDevice } from '../src/devices.js';
import { registerHandlers } from '../src/handlers.js';
import { MESSAGES, zerosDiffer } from '../src/i18n.js';

const MESSAGES_unknown = (language, account, configured) =>
  MESSAGES.unknownAccount[language](account, configured);

class FakeChannel extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.connected = false;
  }
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
  up(info = {}) {
    this.connected = true;
    this.emit('up', info);
  }
  down() {
    this.connected = false;
    this.emit('down');
  }
}

class MemoryStore {
  constructor(data = {}) {
    this.data = structuredClone(data);
    this.saves = 0;
  }
  async load() {
    return structuredClone(this.data);
  }
  async save(data) {
    this.data = structuredClone(data);
    this.saves += 1;
  }
}

const T0 = new Date('2026-10-16T10:00:00Z');
const RUNNING = [
  {
    name: 'sia-receiver',
    status: 'running',
    ports: [
      { container_port: 7777, protocol: 'tcp', host_port: 41001, name: 'sia' },
      { container_port: 7777, protocol: 'udp', host_port: 41002, name: 'sia_udp' },
    ],
  },
];

async function setup(
  t,
  {
    config = { accounts: '1234' },
    containers = [],
    store = new MemoryStore(),
    logger = undefined,
    devices = [],
  } = {},
) {
  const gladys = createFakeGladys({ config, containers, devices });
  const clock = { now: T0 };
  const channels = [];
  const app = new AjaxApp({
    gladys,
    store,
    createChannel: (options) => {
      const channel = new FakeChannel(options);
      channels.push(channel);
      return channel;
    },
    now: () => clock.now,
    logLevel: 'debug',
    ...(logger ? { logger } : {}),
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  await app.statusPending;
  t.after(() => app.stop());
  return {
    gladys,
    app,
    clock,
    store,
    channel: channels[0],
    ids: gladys.externalIds('hub', '1234'),
    // A panel message, with the status that follows it (sent without waiting).
    heard: async (msg) => {
      await app.onChannelMessage(msg);
      await app.statusPending;
    },
    starts: () => gladys.fake.requests.filter((r) => r.path === '/container/sia-receiver/start'),
  };
}

const message = (events, extra = {}) => ({
  type: 'message',
  account: '1234',
  id: 'SIA-DCS',
  sequence: '0001',
  encrypted: false,
  receivedAt: T0.toISOString(),
  events,
  xdata: [],
  duplicate: false,
  ...extra,
});

// The device of an account as the user created it (the fake serves it from GET /device).
const createdDevice = (account) => buildDevice(createFakeGladys(), account, 'fr');

test('start: the receiver gets its environment, one device per account', async (t) => {
  const { gladys, starts, ids, channel } = await setup(t, {
    config: { accounts: '1234, ab12', encryption_key: '0123456789abcdef', time_skew: 30 },
  });
  const [start] = starts();
  const env = start.body.env;
  assert.deepEqual(JSON.parse(env.SIA_ACCOUNTS), [
    { account: '1234', key: Buffer.from('0123456789abcdef').toString('hex') },
    { account: 'AB12', key: Buffer.from('0123456789abcdef').toString('hex') },
  ]);
  assert.equal(env.SIA_TIME_SKEW, '30');
  assert.match(env.CHANNEL_TOKEN, /^[0-9a-f]{48}$/);
  assert.equal(env.LOG_LEVEL, 'debug');
  assert.equal(channel.options.host, 'sia-receiver');
  assert.equal(channel.options.port, 7778);
  assert.equal(channel.options.token, env.CHANNEL_TOKEN);
  assert.equal(channel.started, true);

  const devices = gladys.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((device) => [device.external_id, device.name]),
    [
      [ids.device, 'Alarme Ajax 1234'],
      [gladys.externalIds('hub', 'AB12').device, 'Alarme Ajax AB12'],
    ],
  );
  assert.equal(devices[0].features.length, 9);
  assert.ok(devices[0].features.every((feature) => feature.read_only));
  // Initial states: disarmed, no alarm, never heard.
  assert.equal(gladys.fake.lastState(ids.feature('mode')), 'disarmed');
  assert.equal(gladys.fake.lastState(ids.feature('online')), 0);
  assert.equal(gladys.fake.lastState(ids.feature('mains-power')), 1);
  assert.equal(gladys.fake.lastState(ids.feature('last-event')), undefined);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /SIA receiver/);
});

test('a hub arms, an intrusion: states, scene events, connection status', async (t) => {
  const { gladys, app, channel, ids } = await setup(t, { devices: [createdDevice('1234')] });
  channel.up({ queued: 0 });
  await app.updateConnectionStatus();
  assert.match(gladys.fake.connectionStatus.message.fr, /premier message de la centrale 1234/);

  await app.onChannelMessage(message([{ code: 'CL', number: 5, group: 1 }]));
  assert.equal(gladys.fake.lastState(ids.feature('mode')), 'armed');
  assert.equal(gladys.fake.lastState(ids.feature('armed-groups')), 'tous');
  assert.equal(gladys.fake.lastState(ids.feature('online')), 1);
  assert.equal(
    gladys.fake.lastState(ids.feature('last-event')),
    'Armée, utilisateur 5, groupe 1 (CL)',
  );
  assert.deepEqual(gladys.fake.sceneEvents, [
    {
      key: 'mode_changed',
      data: {
        device: ids.device,
        account: '1234',
        code: 'CL',
        description: 'Armée, utilisateur 5, groupe 1 (CL)',
        mode: 'armed',
        previous_mode: 'disarmed',
        user: 5,
        group: 1,
      },
    },
    {
      key: 'sia_event',
      data: {
        device: ids.device,
        account: '1234',
        code: 'CL',
        description: 'Armée, utilisateur 5, groupe 1 (CL)',
        zone: null,
        user: 5,
        group: 1,
        text: null,
      },
    },
  ]);

  await app.onChannelMessage(message([{ code: 'BA', number: 3, group: 1 }], { sequence: '0002' }));
  assert.equal(gladys.fake.lastState(ids.feature('alarm')), 1);
  const alarm = gladys.fake.sceneEvents.find((event) => event.key === 'alarm');
  assert.deepEqual(alarm.data, {
    device: ids.device,
    account: '1234',
    code: 'BA',
    description: 'Intrusion, appareil 3, groupe 1 (BA)',
    kind: 'intrusion',
    zone: 3,
    group: 1,
    user: null,
    mode: 'armed',
  });
  await app.tick();
  await app.statusPending;
  assert.equal(gladys.fake.connectionStatus.connected, true);

  // Disarm: the alarm ends, a restore event says so.
  await app.onChannelMessage(message([{ code: 'OP', number: 5 }], { sequence: '0003' }));
  assert.equal(gladys.fake.lastState(ids.feature('alarm')), 0);
  assert.equal(gladys.fake.lastState(ids.feature('mode')), 'disarmed');
  const restore = gladys.fake.sceneEvents.find((event) => event.key === 'restore');
  assert.equal(restore.data.kind, 'intrusion');
  assert.equal(restore.data.zone, 3);
});

test('only changed states are sent, the last event always after an event', async (t) => {
  const { gladys, app, ids } = await setup(t);
  await app.onChannelMessage(message([{ code: 'TA', number: 4 }]));
  const before = gladys.fake.states.length;
  await app.onChannelMessage(message([{ code: 'TA', number: 4 }], { sequence: '0002' }));
  const sent = gladys.fake.states.slice(before);
  assert.deepEqual(
    sent.map((state) => state.device_feature_external_id),
    [ids.feature('last-event')],
  );
  // A link test changes nothing.
  const count = gladys.fake.states.length;
  await app.onChannelMessage(message([], { id: 'NULL', sequence: '0000' }));
  assert.equal(gladys.fake.states.length, count);
});

test('a repeat changes nothing; an old kept message updates states without scene events', async (t) => {
  const { gladys, app, clock, ids } = await setup(t);
  await app.onChannelMessage(message([{ code: 'CL', number: 1 }], { duplicate: true }));
  assert.equal(gladys.fake.lastState(ids.feature('mode')), 'disarmed');
  assert.equal(gladys.fake.sceneEvents.length, 0);

  clock.now = new Date(T0.getTime() + 10 * 60_000);
  await app.onChannelMessage(message([{ code: 'CL', number: 1 }]));
  assert.equal(gladys.fake.lastState(ids.feature('mode')), 'armed');
  assert.equal(gladys.fake.sceneEvents.length, 0);
});

test('supervision: two missed periodic tests make the hub silent, a message brings it back', async (t) => {
  const { gladys, app, clock, channel, ids } = await setup(t, {
    config: { accounts: '1234', ping_interval: 1 },
    devices: [createdDevice('1234')],
  });
  channel.up();
  await app.onChannelMessage(message([], { id: 'NULL' }));
  await app.tick();
  await app.statusPending;
  assert.equal(gladys.fake.connectionStatus.connected, true);

  clock.now = new Date(T0.getTime() + 2 * 60_000 + 20_000);
  await app.tick();
  await app.statusPending;
  assert.equal(gladys.fake.lastState(ids.feature('online')), 1, 'within two tests and the grace');

  clock.now = new Date(T0.getTime() + 2 * 60_000 + 31_000);
  await app.tick();
  await app.statusPending;
  assert.equal(gladys.fake.lastState(ids.feature('online')), 0);
  assert.deepEqual(gladys.fake.sceneEvents.at(-1), {
    key: 'fault',
    data: {
      device: ids.device,
      account: '1234',
      code: null,
      description: 'Supervision',
      kind: 'offline',
      zone: 0,
    },
  });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /No message from hub 1234/);
  // Once only.
  await app.tick();
  await app.statusPending;
  assert.equal(gladys.fake.sceneEvents.filter((event) => event.key === 'fault').length, 1);

  await app.onChannelMessage(message([], { id: 'NULL', receivedAt: clock.now.toISOString() }));
  assert.equal(gladys.fake.lastState(ids.feature('online')), 1);
  assert.equal(gladys.fake.sceneEvents.at(-1).key, 'restore');
  assert.equal(gladys.fake.sceneEvents.at(-1).data.kind, 'offline');
});

test('no supervision (0): a hub heard once stays online', async (t) => {
  const { gladys, app, clock, ids } = await setup(t, {
    config: { accounts: '1234', ping_interval: 0 },
  });
  await app.onChannelMessage(message([]));
  clock.now = new Date(T0.getTime() + 7 * 86_400_000);
  await app.tick();
  await app.statusPending;
  assert.equal(gladys.fake.lastState(ids.feature('online')), 1);
});

test('a restart keeps the learned state and does not restart a running receiver', async (t) => {
  const store = new MemoryStore();
  const first = await setup(t, { store });
  await first.app.onChannelMessage(message([{ code: 'NL', number: 2 }]));
  await first.app.stop();
  assert.equal(first.starts().length, 1);

  const second = await setup(t, { store, containers: RUNNING });
  assert.equal(second.starts().length, 0, 'same env, container running');
  assert.equal(second.gladys.fake.lastState(second.ids.feature('mode')), 'night');
  assert.equal(store.data.token, first.channel.options.token);
});

test('an upgrade from channel protocol 1 recreates the running receiver, same token', async (t) => {
  // What 0.1.1 stored: the hash of an env without CHANNEL_PROTOCOL.
  const token = 'a'.repeat(48);
  const oldEnv = {
    SIA_ACCOUNTS: JSON.stringify([{ account: '1234', key: '' }]),
    SIA_TIME_SKEW: '60',
    CHANNEL_TOKEN: token,
    LOG_LEVEL: 'debug',
  };
  const receiverEnvHash = createHash('sha256').update(JSON.stringify(oldEnv)).digest('hex');
  const store = new MemoryStore({ token, receiverEnvHash });
  const { app, starts, channel } = await setup(t, { store, containers: RUNNING });
  assert.equal(starts().length, 1, 'the receiver on the old image is recreated');
  const env = starts()[0].body.env;
  assert.equal(env.CHANNEL_PROTOCOL, '2');
  // Only the protocol differs: without it, 0.1.1 would have left the receiver alone.
  const { CHANNEL_PROTOCOL: _protocol, ...withoutProtocol } = env;
  assert.equal(JSON.stringify(withoutProtocol), JSON.stringify(oldEnv));
  assert.equal(env.CHANNEL_TOKEN, token, 'no reconfiguration: the token from /data is kept');
  assert.equal(channel.options.token, token);
  assert.notEqual(app.data.receiverEnvHash, receiverEnvHash);
});

test('a configuration change recreates the receiver only when its environment changes', async (t) => {
  const { gladys, app, starts } = await setup(t, { containers: RUNNING });
  assert.equal(starts().length, 1, 'first start: no fingerprint yet');
  await gladys.fake.configUpdated({ accounts: '1234', language: 'fr' });
  await app.statusPending;
  assert.equal(starts().length, 1);
  await gladys.fake.configUpdated({ accounts: '1234 5678' });
  await app.statusPending;
  assert.equal(starts().length, 2);
  assert.equal(JSON.parse(starts()[1].body.env.SIA_ACCOUNTS).length, 2);
  assert.equal(gladys.fake.discoveredDevices.length, 2);
  // Language: names in English from now on.
  await gladys.fake.configUpdated({ accounts: '1234 5678', language: 'en' });
  await app.statusPending;
  assert.equal(gladys.fake.discoveredDevices[0].name, 'Ajax alarm 1234');
  assert.equal(starts().length, 2);
  assert.equal(app.config.language, 'en');
});

test('configuration problems show in the connection status', async (t) => {
  let { gladys } = await setup(t, { config: {} });
  assert.match(gladys.fake.connectionStatus.message.en, /object number/);
  ({ gladys } = await setup(t, { config: { accounts: '1234 zz', encryption_key: 'short' } }));
  assert.match(gladys.fake.connectionStatus.message.en, /encryption key is not valid/);
  assert.equal(gladys.fake.discoveredDevices.length, 1);
});

test('a receiver that cannot start shows in the status', async (t) => {
  const gladys = createFakeGladys({ config: { accounts: '1234' } });
  t.mock.method(gladys, 'startContainer', async () => {
    throw new Error('404 container not declared');
  });
  const app = new AjaxApp({
    gladys,
    store: new MemoryStore(),
    createChannel: (options) => new FakeChannel(options),
    now: () => T0,
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  await app.statusPending;
  t.after(() => app.stop());
  assert.match(gladys.fake.connectionStatus.message.en, /could not start: 404/);
});

test('refusals: a panel with an unknown account shows in the status button', async (t) => {
  const { gladys, app, channel } = await setup(t, { containers: RUNNING });
  channel.up();
  await app.onChannelMessage({
    type: 'rejected',
    reason: 'unknown_account',
    account: '9999',
    problem: 'Unknown account 9999: add it to the configuration',
  });
  await app.statusPending;
  const ack = await gladys.fake.action('status', {});
  assert.equal(ack.success, true);
  const text = ack.data.message;
  assert.match(text.en, /SIA receiver: connected \(TCP 41001, UDP 41002\)/);
  assert.match(text.en, /Hub 1234: disarmed, silent, last message never/);
  assert.match(text.en, /Last refusal: Unknown account 9999/);
  assert.match(text.fr, /Centrale 1234 : disarmed/);
});

const recordingLogger = () => {
  const warnings = [];
  const noop = () => {};
  return { warnings, warn: (text) => warnings.push(text), info: noop, debug: noop, error: noop };
};

test('refusals: account 000 (empty object number) names the account and the steps', async (t) => {
  const logger = recordingLogger();
  const { gladys, app, channel, clock } = await setup(t, { containers: RUNNING, logger });
  channel.up();
  await app.onChannelMessage({
    type: 'rejected',
    reason: 'unknown_account',
    account: '000',
    problem: 'Unknown account 000: add it to the configuration',
  });
  await app.statusPending;
  const [warning] = logger.warnings;
  assert.match(
    warning,
    /A hub sends account 000, which is not in the configuration \(configured: 1234\)/,
  );
  assert.match(warning, /set "Object number" to 1234 in the Ajax app/);
  assert.match(warning, /add 000 to "Account number\(s\)"/);
  assert.match(warning, /000 is what an Ajax hub sends when its object number is empty/);
  const status = gladys.fake.connectionStatus;
  assert.equal(status.connected, false);
  assert.match(
    status.message.fr,
    /Une centrale envoie le compte 000, absent de la configuration \(configuré : 1234\)/,
  );
  assert.match(status.message.fr, /Saisissez 1234 dans « Numéro d'objet »/);
  assert.match(status.message.fr, /ajoutez 000 à « Numéro\(s\) de compte »/);
  assert.match(status.message.fr, /numéro d'objet est vide/);
  assert.match(status.message.en, /set "Object number" to 1234/);
  // The user adds 000: the status no longer asks for it.
  await gladys.fake.configUpdated({ accounts: '1234, 000' });
  await app.statusPending;
  await app.updateConnectionStatus();
  assert.doesNotMatch(gladys.fake.connectionStatus.message.en, /sends account/);
  await gladys.fake.configUpdated({ accounts: '1234' });
  await app.statusPending;
  await app.updateConnectionStatus();
  assert.match(gladys.fake.connectionStatus.message.en, /sends account 000/);

  // Still shown at the limit, gone after it: back to waiting for the hub.
  clock.now = new Date(T0.getTime() + 5 * 60_000);
  await app.updateConnectionStatus();
  assert.match(gladys.fake.connectionStatus.message.en, /sends account 000/);
  clock.now = new Date(T0.getTime() + 5 * 60_000 + 1);
  await app.updateConnectionStatus();
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /Waiting for the first message of hub 1234/,
  );
  // A clock that went back does not bring it back either.
  clock.now = new Date(T0.getTime() - 1);
  await app.updateConnectionStatus();
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /Waiting for the first message of hub 1234/,
  );
});

test('refusals: another account, several configured, none configured', async (t) => {
  const logger = recordingLogger();
  const { gladys, app, channel } = await setup(t, {
    containers: RUNNING,
    logger,
    config: { accounts: '1234, 5678' },
  });
  channel.up();
  await app.onChannelMessage({ type: 'rejected', reason: 'unknown_account', account: '9999' });
  await app.statusPending;
  assert.match(
    logger.warnings[0],
    /account 9999, which is not in the configuration \(configured: 1234, 5678\)/,
  );
  assert.match(logger.warnings[0], /to one of the configured numbers in the Ajax app/);
  assert.doesNotMatch(logger.warnings[0], /object number is empty/);
  assert.match(gladys.fake.connectionStatus.message.fr, /Saisissez l'un des numéros configurés/);
  assert.equal(MESSAGES_unknown('en', '000', []).includes('(configured: none)'), true);
  assert.equal(MESSAGES_unknown('fr', '000', []).includes('(configuré : aucun)'), true);
});

test('refusals: once the account is configured, its messages count and the status clears', async (t) => {
  const logger = recordingLogger();
  const { gladys, app, channel } = await setup(t, {
    containers: RUNNING,
    logger,
    config: { accounts: '000' },
    devices: [createdDevice('000')],
  });
  channel.up();
  await app.onChannelMessage({ type: 'rejected', reason: 'unknown_account', account: '000' });
  await app.statusPending;
  // A refusal reported just before the new configuration: not shown for a configured account.
  assert.doesNotMatch(gladys.fake.connectionStatus.message.en, /sends account/);
  await app.onChannelMessage(message([{ code: 'CL', number: 5, group: 1 }], { account: '000' }));
  const ids = gladys.externalIds('hub', '000');
  assert.equal(gladys.fake.lastState(ids.feature('mode')), 'armed');
  await app.updateConnectionStatus();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.deepEqual(logger.warnings.length, 0);
});

test('refusals: other reasons are logged with their account, junk without one is not', async (t) => {
  const logger = recordingLogger();
  const { app, channel } = await setup(t, { containers: RUNNING, logger });
  channel.up();
  await app.onChannelMessage({
    type: 'rejected',
    reason: 'key',
    account: '1234',
    problem: 'Account 1234: Decryption failed (wrong key?)',
  });
  await app.statusPending;
  await app.onChannelMessage({ type: 'rejected', reason: 'format', problem: 'Not a DC-09 frame' });
  await app.statusPending;
  await app.onChannelMessage({
    type: 'rejected',
    reason: 'unknown_account',
    problem: 'Message without an account number',
  });
  await app.statusPending;
  assert.deepEqual(logger.warnings, [
    'A message of a hub was refused: Account 1234: Decryption failed (wrong key?)',
  ]);
});

test('refusals: one warning per refused account, then at most one per hour', async (t) => {
  const logger = recordingLogger();
  const { app, channel, clock } = await setup(t, { containers: RUNNING, logger });
  channel.up();
  const refuse = async (account, reason = 'unknown_account') => {
    await app.onChannelMessage({
      type: 'rejected',
      reason,
      account,
      problem: `${reason} ${account}`,
    });
    await app.statusPending;
  };
  const at = (minutes) => (clock.now = new Date(T0.getTime() + minutes * 60_000));
  await refuse('000');
  await refuse('9999');
  await refuse('1234', 'key');
  assert.equal(logger.warnings.length, 3);
  at(1);
  await refuse('000');
  await refuse('1234', 'key');
  at(59);
  await refuse('000');
  assert.equal(logger.warnings.length, 3);
  at(60);
  await refuse('000');
  await refuse('1234', 'key');
  assert.equal(logger.warnings.length, 5);
  assert.match(logger.warnings[3], /sends account 000/);
  assert.equal(logger.warnings[4], 'A message of a hub was refused: key 1234');
  // A clock set back does not silence the refusal for the hour.
  at(-1);
  await refuse('000');
  assert.equal(logger.warnings.length, 6);
  // Many accounts: the memory of the warnings stays bounded.
  for (let n = 0; n < 300; n += 1) await refuse(n.toString(16).padStart(3, '0').toUpperCase());
  assert.ok(app.refusalsLogged.size <= 256);
});

test('refusals: dated by the receiver, the status window follows the periodic test', async (t) => {
  const { gladys, app, channel, clock } = await setup(t, {
    containers: RUNNING,
    config: { accounts: '1234', ping_interval: 10 },
  });
  channel.up();
  const refuse = async (at) => {
    await app.onChannelMessage({ type: 'rejected', reason: 'unknown_account', account: '000', at });
    await app.statusPending;
  };
  const status = () => gladys.fake.connectionStatus.message.en;
  // Kept in the queue for 30 min: older than two periodic tests (20.5 min), not shown.
  await refuse(new Date(T0.getTime() - 30 * 60_000).toISOString());
  assert.doesNotMatch(status(), /sends account/);
  // 10 min old: within two tests of 10 min, shown, and still 10 min later.
  await refuse(new Date(T0.getTime() - 10 * 60_000).toISOString());
  assert.match(status(), /sends account 000/);
  clock.now = new Date(T0.getTime() + 10 * 60_000);
  await app.updateConnectionStatus();
  assert.match(status(), /sends account 000/);
  clock.now = new Date(T0.getTime() + 10 * 60_000 + 30_001);
  await app.updateConnectionStatus();
  assert.doesNotMatch(status(), /sends account/);
  // A date in the future counts as now; an unreadable one too.
  await refuse(new Date(clock.now.getTime() + 3600_000).toISOString());
  assert.equal(app.receiver.unknownAccount.at, clock.now.getTime());
  await refuse('garbage');
  assert.equal(app.receiver.unknownAccount.at, clock.now.getTime());
});

test('clear: the alarm and fault memory is emptied', async (t) => {
  const { gladys, app, ids } = await setup(t, { config: { accounts: '1234', language: 'en' } });
  await app.onChannelMessage(
    message([
      { code: 'FA', number: 2 },
      { code: 'XT', number: 6 },
    ]),
  );
  assert.equal(gladys.fake.lastState(ids.feature('alarm')), 1);
  assert.equal(gladys.fake.lastState(ids.feature('battery-low')), 1);
  const ack = await gladys.fake.action('clear', {});
  assert.equal(ack.data.message.en, 'Alarm and fault memory cleared (1 hub).');
  assert.equal(gladys.fake.lastState(ids.feature('alarm')), 0);
  assert.equal(gladys.fake.lastState(ids.feature('battery-low')), 0);
  assert.equal(gladys.fake.lastState(ids.feature('last-event')), 'Low battery, device 6 (XT)');
});

test('the channel wiring: messages and the receiver going down', async (t) => {
  const { gladys, channel, ids } = await setup(t);
  channel.up();
  channel.emit('message', message([{ code: 'CL', number: 1 }]));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(gladys.fake.lastState(ids.feature('mode')), 'armed');
  channel.down();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(gladys.fake.connectionStatus.message.en, /SIA receiver/);
});

test('a burst of messages is applied and published in order (found by the e2e)', async (t) => {
  const { gladys, app, channel, ids } = await setup(t);
  channel.up();
  // The receiver flushes its queue in one chunk: the events fire synchronously.
  channel.emit('message', message([{ code: 'CL', number: 1 }], { sequence: '0001' }));
  channel.emit('message', message([{ code: 'BA', number: 3 }], { sequence: '0002' }));
  channel.emit('message', message([{ code: 'OP', number: 1 }], { sequence: '0003' }));
  await app.chain;
  assert.deepEqual(
    gladys.fake.states
      .filter((state) => state.device_feature_external_id === ids.feature('mode'))
      .map((state) => state.text),
    ['disarmed', 'armed', 'disarmed'],
  );
  assert.equal(gladys.fake.lastState(ids.feature('alarm')), 0);
  assert.deepEqual(
    gladys.fake.sceneEvents.filter((e) => e.key === 'sia_event').map((e) => e.data.code),
    ['CL', 'BA', 'OP'],
  );
});

test('messages for an account no longer configured are ignored', async (t) => {
  const { gladys, app } = await setup(t);
  const count = gladys.fake.states.length;
  await app.onChannelMessage(message([{ code: 'CL' }], { account: '9999' }));
  assert.equal(gladys.fake.states.length, count);
});

test('a configured hub reports while its device is not added: Discovery lists it, status and one log say so', async (t) => {
  const logger = recordingLogger();
  const { gladys, app, channel, clock, ids, heard } = await setup(t, {
    containers: RUNNING,
    logger,
  });
  channel.up();
  await app.statusPending;
  // Nothing heard yet: waiting for the hub, not for the device.
  assert.match(gladys.fake.connectionStatus.message.fr, /premier message de la centrale 1234/);
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => device.external_id),
    [ids.device],
  );

  await heard(message([{ code: 'CG', number: 5, group: 1 }]));
  // The states went out (Gladys drops them without the device), the status says what to do.
  assert.equal(gladys.fake.lastState(ids.feature('mode')), 'partial');
  const status = gladys.fake.connectionStatus;
  assert.equal(status.connected, false);
  assert.match(status.message.fr, /^La centrale Alarme Ajax 1234 transmet, mais son appareil/);
  assert.match(status.message.fr, /ajoutez-le depuis l'onglet Découverte/);
  assert.match(status.message.fr, /supprimez l'ancien et refaites ses widgets/);
  assert.match(status.message.en, /^Hub Ajax alarm 1234 reports, but its device is not in Gladys/);
  assert.match(status.message.en, /add it from the Discovery tab/);
  assert.deepEqual(logger.warnings, [MESSAGES.deviceMissing.en(['Alarme Ajax 1234'])]);
  // The status button says it too.
  const ack = await gladys.fake.action('status', {});
  assert.match(
    ack.data.message.fr,
    /Centrale 1234 : partial, joignable, .*appareil non ajouté dans Gladys \(onglet Découverte\)\./,
  );
  assert.match(ack.data.message.en, /device not added in Gladys \(Discovery tab\)\./);

  // More messages within the hour: no new line; after an hour, one more.
  const later = (minutes, events, sequence) => {
    clock.now = new Date(T0.getTime() + minutes * 60_000);
    return heard(message(events, { sequence, receivedAt: clock.now.toISOString() }));
  };
  await later(59, [{ code: 'OG', number: 5, group: 1 }], '0002');
  assert.equal(logger.warnings.length, 1);
  await later(60, [{ code: 'CG', number: 5, group: 1 }], '0003');
  assert.equal(logger.warnings.length, 2);

  // The user adds it from Discovery: states again, status connected, nothing about the device.
  const count = gladys.fake.states.length;
  await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[0]);
  await app.statusPending;
  assert.equal(
    gladys.fake.states
      .slice(count)
      .find((s) => s.device_feature_external_id === ids.feature('mode')).text,
    'partial',
  );
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.connectionStatus.message, undefined);
  assert.doesNotMatch((await gladys.fake.action('status', {})).data.message.fr, /non ajouté/);
  await later(61, [{ code: 'OG', number: 5, group: 1 }], '0004');
  assert.equal(logger.warnings.length, 2);

  // Deleted again: the notice comes back at once.
  await gladys.fake.deviceDeleted(gladys.fake.discoveredDevices[0]);
  await app.statusPending;
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /not in Gladys/);
  await later(62, [{ code: 'CG', number: 5, group: 1 }], '0005');
  assert.equal(logger.warnings.length, 3);
});

test('a changed account number: the new hub is in Discovery, the old device is an orphan', async (t) => {
  const logger = recordingLogger();
  const { gladys, app, channel, heard } = await setup(t, {
    containers: RUNNING,
    logger,
    config: { accounts: '007', language: 'en' },
    devices: [createdDevice('007')],
  });
  channel.up();
  assert.deepEqual(logger.warnings, []);
  // The hub still on 007 reports: all good.
  await heard(message([{ code: 'CL', number: 1 }], { account: '007' }));
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.connectionStatus.message, undefined);

  // The user sets 1234 in the Ajax app and in Gladys.
  await gladys.fake.configUpdated({ accounts: '1234', language: 'en' });
  await app.statusPending;
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => device.name),
    ['Ajax alarm 1234'],
    'Discovery offers the new hub only',
  );
  assert.deepEqual(logger.warnings, [MESSAGES.orphanDevice.en(['Ajax alarm 007'])]);
  await heard(message([{ code: 'CG', number: 5, group: 1 }]));
  // The missing device comes first: it is what keeps the dashboard empty.
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /^Hub Ajax alarm 1234 reports, but its device is not in Gladys/,
  );
  assert.match(gladys.fake.connectionStatus.message.fr, /^La centrale Alarme Ajax 1234 transmet/);
  assert.equal(logger.warnings.length, 2);
  const button = (await gladys.fake.action('status', {})).data.message;
  assert.match(button.en, /Hub 1234: partial, reporting, .*device not added in Gladys/);
  assert.match(
    button.en,
    /Device Ajax alarm 007 in Gladys belongs to an account that is no longer configured/,
  );
  assert.match(
    button.fr,
    /L'appareil Alarme Ajax 007 de Gladys correspond à un compte qui n'est plus configuré/,
  );

  // Added from Discovery: connected, with the note about the leftover device.
  await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[0]);
  await app.statusPending;
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /^Device Ajax alarm 007 in Gladys belongs to an account that is no longer configured: it gets no state any more\. Delete it \(or add the account back\)\./,
  );
  assert.match(gladys.fake.connectionStatus.message.fr, /Supprimez-le \(ou remettez le compte/);
  // Deleted: clean.
  await gladys.fake.deviceDeleted(createdDevice('007'));
  await app.statusPending;
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.connectionStatus.message, undefined);
  assert.doesNotMatch(
    (await gladys.fake.action('status', {})).data.message.en,
    /no longer configured/,
  );
  // The orphan notice: once at the change, once more after its creation/deletion cycle.
  assert.equal(logger.warnings.filter((w) => /no longer configured/.test(w)).length, 2);
});

test('several hubs: missing devices and orphans are listed; a silent hub with its device is silent', async (t) => {
  const { gladys, app, channel, clock, heard } = await setup(t, {
    containers: RUNNING,
    config: { accounts: '1234, 5678, 9ABC', language: 'en' },
    devices: [createdDevice('9ABC'), createdDevice('AAA'), createdDevice('BBB')],
  });
  channel.up();
  for (const account of ['1234', '5678', '9ABC']) {
    await heard(message([{ code: 'RP' }], { account }));
  }
  const status = gladys.fake.connectionStatus;
  assert.equal(status.connected, false);
  assert.match(
    status.message.en,
    /^Hubs Ajax alarm 1234, Ajax alarm 5678 report, but their devices are not in Gladys: add them from the Discovery tab/,
  );
  assert.match(
    status.message.fr,
    /^Les centrales Alarme Ajax 1234, Alarme Ajax 5678 transmettent, mais leurs appareils/,
  );
  const button = (await gladys.fake.action('status', {})).data.message.en;
  assert.match(
    button,
    /Devices Ajax alarm AAA, Ajax alarm BBB in Gladys belong to an account that is no longer configured: they get no state any more\. Delete them/,
  );
  assert.match(
    (await gladys.fake.action('status', {})).data.message.fr,
    /Les appareils Alarme Ajax AAA, Alarme Ajax BBB de Gladys correspondent à des comptes qui ne sont plus configurés : ils ne reçoivent plus d'état\. Supprimez-les/,
  );
  // Their devices created: 9ABC goes silent, which wins over the orphans.
  await gladys.fake.deviceCreated(createdDevice('1234'));
  await app.statusPending;
  await gladys.fake.deviceCreated(createdDevice('5678'));
  await app.statusPending;
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /^Devices Ajax alarm AAA, Ajax alarm BBB/);
  clock.now = new Date(T0.getTime() + 3 * 60_000);
  await app.tick();
  await app.statusPending;
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /No message from hub 1234, 5678, 9ABC/);
});

test('a device whose id is not a hub, or a feature id, is not an account', async (t) => {
  const { app } = await setup(t, {
    devices: [
      { external_id: 'ext:test-integration:other:1234', features: [] },
      { external_id: 'ext:test-integration:hub:1234:mode', features: [] },
      { external_id: 'ext:test-integration:hub:zz', features: [] },
      { features: [] },
    ],
  });
  assert.deepEqual([...app.createdAccounts()], []);
  assert.deepEqual(app.orphanDevices(), []);
});

test('refusals: an account that differs by its leading zeros gets the hint', async (t) => {
  const logger = recordingLogger();
  const { gladys, app, channel } = await setup(t, {
    containers: RUNNING,
    logger,
    config: { accounts: '0012, 5678, 0000' },
  });
  channel.up();
  await app.onChannelMessage({ type: 'rejected', reason: 'unknown_account', account: '012' });
  await app.statusPending;
  assert.match(
    logger.warnings[0],
    /leading zeros included: 012 and 0012 are two different accounts\.$/,
  );
  assert.match(
    gladys.fake.connectionStatus.message.fr,
    /zéros de tête compris : 012 et 0012 sont deux comptes différents\.$/,
  );
  await app.onChannelMessage({ type: 'rejected', reason: 'unknown_account', account: '000012' });
  await app.statusPending;
  assert.match(logger.warnings[1], /000012 and 0012 are two different accounts/);
  // No hint for an unrelated number, nor for zeros only (its own sentence).
  await app.onChannelMessage({ type: 'rejected', reason: 'unknown_account', account: '9999' });
  await app.statusPending;
  assert.doesNotMatch(logger.warnings[2], /leading zeros/);
  await app.onChannelMessage({ type: 'rejected', reason: 'unknown_account', account: '000' });
  await app.statusPending;
  assert.doesNotMatch(logger.warnings[3], /leading zeros/);
  assert.match(logger.warnings[3], /object number is empty/);
  // The helper itself (accounts are upper case already): zeros only never match a run of zeros.
  assert.equal(zerosDiffer('000', ['0000', '0012']), undefined);
  assert.equal(zerosDiffer('012', ['0012']), '0012');
  assert.equal(zerosDiffer('0012', ['0012']), undefined);
  assert.equal(zerosDiffer('AB', ['00AB']), '00AB');
});

test('status order: a silent hub is never said to report; a missing device beats waiting for another hub', async (t) => {
  const { gladys, app, clock, channel, heard } = await setup(t, {
    containers: RUNNING,
    config: { accounts: '1234, 5678', language: 'en' },
  });
  channel.up();
  await heard(message([{ code: 'RP' }]));
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /^Hub Ajax alarm 1234 reports, but its device/,
  );
  // 1234 stops reporting: silent, whatever its device; 5678 never heard stays behind.
  clock.now = new Date(T0.getTime() + 3 * 60_000);
  await app.tick();
  await app.statusPending;
  assert.equal(
    gladys.fake.connectionStatus.message.en,
    'No message from hub 1234 within the periodic test interval.',
  );
  // Reporting again: the missing device, before "waiting for 5678".
  await heard(message([{ code: 'RP' }], { sequence: '0002', receivedAt: clock.now.toISOString() }));
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /^Hub Ajax alarm 1234 reports, but its device/,
  );
  await gladys.fake.deviceCreated(createdDevice('1234'));
  await app.statusPending;
  assert.equal(
    gladys.fake.connectionStatus.message.en,
    'Waiting for the first message of hub 5678.',
  );
});

test('orphans: logged once at start, not again on config saves or reconnections', async (t) => {
  const logger = recordingLogger();
  const { gladys, app } = await setup(t, {
    containers: RUNNING,
    logger,
    config: { accounts: '1234', language: 'en' },
    devices: [createdDevice('AAA')],
  });
  assert.deepEqual(logger.warnings, [MESSAGES.orphanDevice.en(['Ajax alarm AAA'])]);
  await gladys.fake.configUpdated({ accounts: '1234', language: 'en' });
  await app.statusPending;
  await gladys.fake.configUpdated({ accounts: '1234', language: 'en' });
  await app.statusPending;
  await gladys.connect();
  await app.statusPending;
  await gladys.connect();
  await app.statusPending;
  assert.equal(logger.warnings.length, 1);
  assert.equal(app.refusalsLogged.size, 1);
});

test('the status never delays the scenes, and is not retried on every message while it fails', async (t) => {
  const { gladys, app, channel, clock, heard } = await setup(t, {
    containers: RUNNING,
    config: { accounts: '1234, 5678', language: 'en' },
  });
  channel.up();
  await app.updateConnectionStatus();
  const trace = [];
  const statusCalls = () => trace.filter((entry) => entry === 'status').length;
  const original = gladys.setConnectionStatus.bind(gladys);
  let failing = true;
  gladys.setConnectionStatus = async (...args) => {
    trace.push('status');
    if (failing) throw new Error('host API down');
    return original(...args);
  };
  const scene = gladys.publishSceneEvent.bind(gladys);
  gladys.publishSceneEvent = async (...args) => {
    trace.push('scene');
    return scene(...args);
  };
  await heard(message([{ code: 'BA', number: 3 }]));
  assert.deepEqual(trace, ['scene', 'scene', 'status'], 'the alarm scenes first, the status after');
  // While it fails, more messages do not retry it: the tick does.
  await heard(message([{ code: 'BR', number: 3 }], { sequence: '0002' }));
  await heard(message([{ code: 'BA', number: 4 }], { sequence: '0003' }));
  assert.equal(statusCalls(), 1);
  await app.tick();
  await app.statusPending;
  assert.equal(statusCalls(), 2);
  // Back: the tick sends it, and the messages follow it again.
  failing = false;
  clock.now = new Date(T0.getTime() + 15_000);
  await app.tick();
  await app.statusPending;
  assert.equal(statusCalls(), 3);
  assert.match(gladys.fake.connectionStatus.message.en, /^Hub Ajax alarm 1234 reports/);
  await heard(message([{ code: 'RP' }], { account: '5678', receivedAt: clock.now.toISOString() }));
  assert.equal(statusCalls(), 4);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /^Hubs Ajax alarm 1234, Ajax alarm 5678 report/,
  );
});

test('two status changes a few ms apart: sent one after the other, the last one wins', async (t) => {
  const { gladys, app, channel } = await setup(t, {
    containers: RUNNING,
    config: { accounts: '1234, AB12', language: 'en' },
    devices: [createdDevice('1234'), createdDevice('AB12')],
  });
  channel.up();
  await app.updateConnectionStatus();
  assert.match(gladys.fake.connectionStatus.message.en, /first message of hub 1234, AB12/);
  // The first request is slow (the core answers after a lookup), the next ones fast.
  const original = gladys.setConnectionStatus.bind(gladys);
  let delay = 50;
  gladys.setConnectionStatus = async (...args) => {
    const wait = delay;
    delay = 1;
    await new Promise((resolve) => setTimeout(resolve, wait));
    return original(...args);
  };
  await app.onChannelMessage(message([], { id: 'NULL' }));
  await app.onChannelMessage(message([], { id: 'NULL', account: 'AB12' }));
  await app.statusPending;
  // Long enough for any request still in flight (a parallel slow one) to land.
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.connectionStatus.message, undefined);
  assert.deepEqual(
    gladys.fake.connectionStatuses.slice(-2).map((status) => status.connected),
    [false, true],
    'one request at a time, in order',
  );
  // The receiver going down and up: the same queue, applied in order.
  channel.down();
  channel.up();
  await app.statusPending;
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('an old kept message updates the status at once, without a scene event', async (t) => {
  const { gladys, app, channel, heard } = await setup(t, { containers: RUNNING });
  channel.up();
  await app.statusPending;
  assert.match(gladys.fake.connectionStatus.message.en, /first message of hub 1234/);
  const scenes = gladys.fake.sceneEvents.length;
  await heard(
    message([{ code: 'CL' }], { receivedAt: new Date(T0.getTime() - 10 * 60_000).toISOString() }),
  );
  assert.equal(gladys.fake.sceneEvents.length, scenes);
  // Heard 10 min ago: silent already, said at once (not by the next tick).
  assert.equal(
    gladys.fake.connectionStatus.message.en,
    'No message from hub 1234 within the periodic test interval.',
  );
});

test('a Gladys restart: the unchanged status is sent again at the reconnection', async (t) => {
  const { gladys, app } = await setup(t, { containers: RUNNING, devices: [createdDevice('1234')] });
  const sent = gladys.fake.connectionStatuses.length;
  assert.ok(sent > 0);
  await gladys.connect();
  await app.statusPending;
  assert.equal(gladys.fake.connectionStatuses.length, sent + 1);
  assert.deepEqual(gladys.fake.connectionStatuses.at(-1), gladys.fake.connectionStatuses.at(-2));
});

const bounded = (promise, ms, what) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} hung`)), ms)),
  ]);

test('a status that never answers: a burst, then the tick returns at once and an alarm fires its scenes', async (t) => {
  const { gladys, app, channel } = await setup(t, {
    containers: RUNNING,
    config: { accounts: '1234', language: 'en' },
  });
  channel.up();
  await app.statusPending;
  let calls = 0;
  gladys.setConnectionStatus = () => {
    calls += 1;
    return new Promise(() => {});
  };
  // The first message changes the status: that request never answers.
  await app.onChannelMessage(message([], { id: 'NULL' }));
  for (let n = 2; n <= 60; n += 1) {
    await app.onChannelMessage(message([], { id: 'NULL', sequence: String(n).padStart(4, '0') }));
  }
  await bounded(app.tick(), 500, 'the tick');
  await bounded(gladys.fake.configUpdated({ accounts: '1234', language: 'en' }), 500, 'the config');
  const scenes = gladys.fake.sceneEvents.length;
  await bounded(
    app.onChannelMessage(message([{ code: 'BA', number: 3 }], { sequence: '0099' })),
    500,
    'the alarm',
  );
  assert.deepEqual(
    gladys.fake.sceneEvents.slice(scenes).map((e) => e.key),
    ['alarm', 'sia_event'],
    'the scenes fire while the status hangs',
  );
  assert.equal(calls, 1, 'one request in flight, the waiting one shares the rest');
});

test('a status that fails slowly: the requests waiting their turn merge into one', async (t) => {
  const { gladys, app, channel } = await setup(t, {
    containers: RUNNING,
    config: { accounts: '1234', language: 'en' },
  });
  channel.up();
  await app.statusPending;
  let calls = 0;
  gladys.setConnectionStatus = () =>
    new Promise((_, reject) => {
      calls += 1;
      setTimeout(() => reject(new Error('slow failure')), 20);
    });
  // Six messages while the first request is in flight: one request in flight, one waiting.
  for (let n = 1; n <= 6; n += 1) {
    await app.onChannelMessage(message([], { id: 'NULL', sequence: String(n).padStart(4, '0') }));
  }
  await app.statusPending;
  await app.statusPending;
  assert.equal(calls, 2, 'the first, then the one that waited (recomputed), nothing else');
  assert.equal(app.statusFailed, true);
  // The tick is the retry.
  await app.tick();
  await app.statusPending;
  assert.equal(calls, 3);
});

test('a created device gets every state again', async (t) => {
  const { gladys, app, ids } = await setup(t);
  const count = gladys.fake.states.length;
  await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[0]);
  await app.statusPending;
  const sent = gladys.fake.states.slice(count).map((state) => state.device_feature_external_id);
  assert.ok(sent.includes(ids.feature('mode')));
  assert.ok(sent.includes(ids.feature('online')));
});

test('nothing can be commanded', async (t) => {
  const { gladys } = await setup(t);
  const device = gladys.fake.discoveredDevices[0];
  const ack = await gladys.fake.setValue(device, device.features[0], 'armed');
  assert.equal(ack.success, false);
  assert.match(ack.error, /one-way/);
});

test('scene events are capped below the Gladys limit', async (t) => {
  const { gladys, app } = await setup(t);
  const events = Array.from({ length: 130 }, (_, i) => ({ code: 'SM', number: i + 1 }));
  await app.onChannelMessage(message(events));
  // 130 one-off faults + 130 events = 260 effects, 240 sent.
  assert.equal(gladys.fake.sceneEvents.length, 240);
});
