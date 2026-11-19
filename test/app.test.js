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
import { registerHandlers } from '../src/handlers.js';
import { MESSAGES } from '../src/i18n.js';

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
  } = {},
) {
  const gladys = createFakeGladys({ config, containers });
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
  t.after(() => app.stop());
  return {
    gladys,
    app,
    clock,
    store,
    channel: channels[0],
    ids: gladys.externalIds('hub', '1234'),
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
  const { gladys, app, channel, ids } = await setup(t);
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
  });
  channel.up();
  await app.onChannelMessage(message([], { id: 'NULL' }));
  await app.tick();
  assert.equal(gladys.fake.connectionStatus.connected, true);

  clock.now = new Date(T0.getTime() + 2 * 60_000 + 20_000);
  await app.tick();
  assert.equal(gladys.fake.lastState(ids.feature('online')), 1, 'within two tests and the grace');

  clock.now = new Date(T0.getTime() + 2 * 60_000 + 31_000);
  await app.tick();
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
  assert.equal(starts().length, 1);
  await gladys.fake.configUpdated({ accounts: '1234 5678' });
  assert.equal(starts().length, 2);
  assert.equal(JSON.parse(starts()[1].body.env.SIA_ACCOUNTS).length, 2);
  assert.equal(gladys.fake.discoveredDevices.length, 2);
  // Language: names in English from now on.
  await gladys.fake.configUpdated({ accounts: '1234 5678', language: 'en' });
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
  await app.updateConnectionStatus();
  assert.doesNotMatch(gladys.fake.connectionStatus.message.en, /sends account/);
  await gladys.fake.configUpdated({ accounts: '1234' });
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
  });
  channel.up();
  await app.onChannelMessage({ type: 'rejected', reason: 'unknown_account', account: '000' });
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
  await app.onChannelMessage({ type: 'rejected', reason: 'format', problem: 'Not a DC-09 frame' });
  await app.onChannelMessage({
    type: 'rejected',
    reason: 'unknown_account',
    problem: 'Message without an account number',
  });
  assert.deepEqual(logger.warnings, [
    'A message of a hub was refused: Account 1234: Decryption failed (wrong key?)',
  ]);
});

test('refusals: one warning per refused account, then at most one per hour', async (t) => {
  const logger = recordingLogger();
  const { app, channel, clock } = await setup(t, { containers: RUNNING, logger });
  channel.up();
  const refuse = (account, reason = 'unknown_account') =>
    app.onChannelMessage({ type: 'rejected', reason, account, problem: `${reason} ${account}` });
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
  const refuse = (at) =>
    app.onChannelMessage({ type: 'rejected', reason: 'unknown_account', account: '000', at });
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

test('a created device gets every state again', async (t) => {
  const { gladys, ids } = await setup(t);
  const count = gladys.fake.states.length;
  await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[0]);
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
