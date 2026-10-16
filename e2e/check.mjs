// -----------------------------------------------------------------------------
// End-to-end check, run inside the integration image (see e2e/run.sh):
//
//   node e2e/check.mjs env <phase>   prints the receiver env the app builds
//   node e2e/check.mjs run <phase>   SIA frames to the real receiver container
//                                    (TCP and UDP), ACKs checked, then the main
//                                    app (fake Gladys of the SDK) on the real
//                                    channel: states and scene events
//
// The SIA side is test/helpers/siaClient.js, which shares no code with src/sia.
// -----------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { AjaxApp } from '../src/app.js';
import { normalizeConfig, receiverEnv } from '../src/config.js';
import { registerHandlers } from '../src/handlers.js';
import { StateStore } from '../src/store.js';
import {
  buildLine,
  parseReply,
  sendTcp,
  sendUdp,
  siaTimestamp,
} from '../test/helpers/siaClient.js';

const [mode, phase] = process.argv.slice(2);
const TOKEN = process.env.E2E_TOKEN ?? 'e2e-token';
const HOST = process.env.E2E_RECEIVER ?? 'sia-receiver';
const PORT = 7777;
const KEY_TEXT = 'Gladys-Ajax-e2e!';
const KEY = Buffer.from(KEY_TEXT, 'latin1');

const CONFIGS = {
  encrypted: { accounts: '1234, AB12', encryption_key: KEY_TEXT, time_skew: 60, ping_interval: 1 },
  plain: { accounts: '1234', time_skew: 60, ping_interval: 1 },
};

if (mode === 'env') {
  const env = receiverEnv(normalizeConfig(CONFIGS[phase]), TOKEN, 'debug');
  for (const [key, value] of Object.entries(env)) console.log(`${key}=${value}`);
  process.exit(0);
}

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✔ ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  ✖ ${name}\n    ${String(err.message).split('\n').join('\n    ')}`);
  }
}
const waitFor = async (predicate, what, timeout = 10_000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error(`timeout waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

let seq = 1;
const next = () => String(seq++).padStart(4, '0');
const ago = (seconds) => siaTimestamp(new Date(Date.now() - seconds * 1000));

/** The receiver's timestamp must be now (UTC), within 10 s. */
function assertFresh(timestamp) {
  const [, hh, mm, ss, month, day, year] = /^(\d\d):(\d\d):(\d\d),(\d\d)-(\d\d)-(\d{4})$/
    .exec(timestamp)
    .map(Number);
  const at = Date.UTC(year, month - 1, day, hh, mm, ss);
  assert.ok(Math.abs(at - Date.now()) < 10_000, `receiver timestamp ${timestamp} is not now`);
}

async function siaEncrypted() {
  console.log(`SIA DC-09, encrypted accounts, receiver ${HOST}:${PORT}`);
  await check(
    'TCP: encrypted arming -> encrypted ACK, CRC, length, sequence, fresh timestamp',
    async () => {
      const sequence = next();
      const [reply] = await sendTcp(HOST, PORT, [
        buildLine({ account: '1234', key: KEY, sequence, content: '|#1234|Nri1/CL5]' }),
      ]);
      const parsed = parseReply(reply, KEY);
      assert.equal(parsed.verdict, 'ACK');
      assert.equal(parsed.encrypted, true);
      assert.equal(parsed.sequence, sequence);
      assert.equal(parsed.account, '1234');
      assert.equal(parsed.crcOk, true);
      assert.equal(parsed.lengthOk, true);
      assert.match(parsed.plain, /^0+\]_\d\d:\d\d:\d\d,\d\d-\d\d-\d{4}$/);
      assertFresh(parsed.timestamp);
    },
  );
  await check(
    'TCP: three messages on one connection (link test, intrusion, tamper) -> three ACKs',
    async () => {
      const replies = await sendTcp(HOST, PORT, [
        buildLine({ account: '1234', key: KEY, type: 'NULL', sequence: '0000', content: '|]' }),
        buildLine({ account: '1234', key: KEY, sequence: next(), content: '|#1234|Nri1/BA3]' }),
        buildLine({ account: '1234', key: KEY, sequence: next(), content: '|#1234|Nri0/TA7]' }),
      ]);
      assert.deepEqual(
        replies.map((reply) => parseReply(reply, KEY).verdict),
        ['ACK', 'ACK', 'ACK'],
      );
    },
  );
  await check('UDP: encrypted message from the second hub -> encrypted ACK', async () => {
    const reply = await sendUdp(
      HOST,
      PORT,
      buildLine({ account: 'AB12', key: KEY, sequence: next(), content: '|#AB12|Nri0/XT4]' }),
    );
    const parsed = parseReply(reply, KEY);
    assert.equal(parsed.verdict, 'ACK');
    assert.equal(parsed.account, 'AB12');
    assertFresh(parsed.timestamp);
  });
  const nak = async (name, line) =>
    check(`${name} -> NAK with the receiver's time`, async () => {
      const [reply] = await sendTcp(HOST, PORT, [line]);
      const parsed = parseReply(reply);
      assert.equal(parsed.verdict, 'NAK');
      assert.equal(parsed.crcOk, true);
      assertFresh(parsed.timestamp);
    });
  await nak(
    'plain message on an account with a key',
    buildLine({ account: '1234', sequence: next() }),
  );
  await nak(
    'wrong key',
    buildLine({ account: '1234', key: Buffer.from('ThisIsNotTheKey!'), sequence: next() }),
  );
  await nak('unknown account', buildLine({ account: '9999', key: KEY, sequence: next() }));
  await nak(
    'altered CRC',
    buildLine({ account: '1234', key: KEY, sequence: next(), alterCrc: true }),
  );
  await nak(
    'timestamp 10 minutes old',
    buildLine({ account: '1234', key: KEY, sequence: next(), timestamp: ago(600) }),
  );
}

async function siaPlain() {
  console.log(`SIA DC-09, plain account, receiver ${HOST}:${PORT}`);
  await check('TCP: plain arming -> ACK "[]"', async () => {
    const sequence = next();
    const [reply] = await sendTcp(HOST, PORT, [
      buildLine({ account: '1234', sequence, receiver: 'R1', content: '#1234|Nri1/CL2]' }),
    ]);
    const parsed = parseReply(reply);
    assert.equal(parsed.verdict, 'ACK');
    assert.equal(parsed.receiver, 'R1');
    assert.equal(parsed.rest, ']');
  });
  await check('UDP: ADM-CID (Contact ID) -> ACK', async () => {
    const reply = await sendUdp(
      HOST,
      PORT,
      buildLine({
        account: '1234',
        type: 'ADM-CID',
        sequence: next(),
        content: '#1234|1130 01 005]',
      }),
    );
    assert.equal(parseReply(reply).verdict, 'ACK');
  });
  await check('an unsupported message type -> DUH', async () => {
    const [reply] = await sendTcp(HOST, PORT, [
      buildLine({ account: '1234', type: 'SIA-DC3', sequence: next() }),
    ]);
    assert.equal(parseReply(reply).verdict, 'DUH');
  });
  await check('a repeat is acknowledged again', async () => {
    const line = buildLine({ account: '1234', sequence: next(), content: '#1234|Nri1/OP2]' });
    const replies = await sendTcp(HOST, PORT, [line, line]);
    assert.deepEqual(
      replies.map((reply) => parseReply(reply).verdict),
      ['ACK', 'ACK'],
    );
  });
}

async function mainApp() {
  console.log('Main container app (fake Gladys) on the real channel');
  // The token the app keeps in /data is the one the receiver got in its env.
  const store = new StateStore('/data/e2e-state.json');
  await store.save({ token: TOKEN });
  const gladys = createFakeGladys({
    config: CONFIGS[phase],
    containers: [
      {
        name: 'sia-receiver',
        status: 'running',
        ports: [{ container_port: 7777, protocol: 'tcp', host_port: 41001, name: 'sia' }],
      },
    ],
  });
  const app = new AjaxApp({ gladys, store, logLevel: 'debug' });
  registerHandlers(gladys, app);
  await gladys.connect();
  const ids = (account) => gladys.externalIds('hub', account);
  const state = (account, key) => gladys.fake.lastState(ids(account).feature(key));

  await check('the app asks Gladys to start the receiver with exactly its env', async () => {
    const start = gladys.fake.requests.find((r) => r.path === '/container/sia-receiver/start');
    assert.deepEqual(start.body.env, receiverEnv(normalizeConfig(CONFIGS[phase]), TOKEN, 'debug'));
  });
  await check('the messages kept by the receiver arrive once the channel is up', async () => {
    await waitFor(() => app.channel?.connected, 'the channel');
    if (phase === 'encrypted') {
      await waitFor(() => state('1234', 'alarm') === 1, 'the intrusion');
      assert.equal(state('1234', 'mode'), 'armed');
      assert.equal(state('1234', 'tamper'), 1);
      assert.equal(state('AB12', 'battery-low'), 1);
      assert.equal(state('1234', 'online'), 1);
    } else {
      // Armed (CL), an ADM-CID burglary, then disarmed (OP, sent twice: one repeat).
      await waitFor(() => String(state('1234', 'last-event')).includes('(OP)'), 'the disarm');
      assert.equal(state('1234', 'mode'), 'disarmed');
      assert.equal(state('1234', 'alarm'), 0, 'the disarm ended the burglary');
      const codes = gladys.fake.sceneEvents
        .filter((event) => event.key === 'sia_event')
        .map((event) => event.data.code);
      assert.deepEqual(codes, ['CL', 'BA', 'OP'], 'the repeat is not counted twice');
    }
  });
  await check('a live event: states and scene events', async () => {
    const before = gladys.fake.sceneEvents.length;
    const line =
      phase === 'encrypted'
        ? buildLine({ account: '1234', key: KEY, sequence: next(), content: '|#1234|Nri1/OP5]' })
        : buildLine({ account: '1234', sequence: next(), content: '#1234|Nri1/NL3]' });
    const [reply] = await sendTcp(HOST, PORT, [line]);
    assert.equal(parseReply(reply, KEY).verdict, 'ACK');
    const expected = phase === 'encrypted' ? 'disarmed' : 'night';
    await waitFor(() => state('1234', 'mode') === expected, `mode ${expected}`);
    const events = gladys.fake.sceneEvents.slice(before);
    const change = events.find((event) => event.key === 'mode_changed');
    assert.equal(change.data.mode, expected);
    assert.equal(change.data.device, ids('1234').device);
    if (phase === 'encrypted') {
      assert.equal(state('1234', 'alarm'), 0, 'the disarm ends the intrusion');
      assert.ok(events.some((event) => event.key === 'restore' && event.data.kind === 'intrusion'));
    }
  });
  await check('the status button sees the receiver and the hubs', async () => {
    const ack = await gladys.fake.action('status', {});
    assert.match(ack.data.message.en, /SIA receiver: connected \(TCP 41001/);
    assert.match(ack.data.message.en, /Hub 1234: \w+, reporting/);
  });
  await check('the connection status is green', async () => {
    await app.tick();
    assert.equal(gladys.fake.connectionStatus.connected, true);
  });
  await check('the learned state is saved in /data', async () => {
    await app.stop();
    const saved = await store.load();
    assert.equal(saved.token, TOKEN);
    assert.ok(saved.accounts['1234'].lastSeen);
  });
  await gladys.disconnect();
  console.log(`  main process RSS ${Math.round(process.memoryUsage().rss / 1048576)} MB`);
}

if (phase === 'encrypted') await siaEncrypted();
else await siaPlain();
await mainApp();
console.log(`${phase}: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
