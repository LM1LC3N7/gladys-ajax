import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SiaReceiver } from '../src/sia/receiver.js';
import { LINES, PYSIA_KEY } from './fixtures/frames.js';
import { buildLine, parseReply, siaTimestamp } from './helpers/siaClient.js';

const KEY = Buffer.from(PYSIA_KEY, 'latin1');
const NOW = new Date(Date.UTC(2026, 9, 16, 10, 0, 0));

function receiver({ accounts = { 1234: null }, timeSkew = 60, now = NOW } = {}) {
  return new SiaReceiver({
    accounts: new Map(Object.entries(accounts).map(([account, key]) => [account, { key }])),
    timeSkew,
    now: () => now,
  });
}

const at = (seconds) => siaTimestamp(new Date(NOW.getTime() + seconds * 1000));

test('an Ajax event: ACK echoing sequence, line and account, and the events', () => {
  const r = receiver();
  const line = buildLine({
    account: '1234',
    sequence: '0042',
    content: '#1234|Nri1/BA3]',
    timestamp: at(-5),
  });
  const result = r.receive(line);
  const reply = parseReply(result.reply);
  assert.equal(reply.verdict, 'ACK');
  assert.equal(reply.sequence, '0042');
  assert.equal(reply.line, 'L0');
  assert.equal(reply.receiver, '');
  assert.equal(reply.account, '1234');
  assert.equal(reply.crcOk, true);
  assert.equal(reply.lengthOk, true);
  assert.equal(reply.rest, ']');
  assert.deepEqual(result.message.events, [{ code: 'BA', number: 3, group: 1 }]);
  assert.equal(result.message.timestamp, '2026-10-16T09:59:55.000Z');
  assert.equal(result.message.duplicate, false);
});

test('the receiver number is echoed only when the panel sent one', () => {
  const result = receiver().receive(
    buildLine({ account: '1234', receiver: 'R12', line: 'L3', timestamp: at(0) }),
  );
  const reply = parseReply(result.reply);
  assert.equal(reply.receiver, 'R12');
  assert.equal(reply.line, 'L3');
});

test('an encrypted message gets an encrypted ACK with our timestamp', () => {
  const r = receiver({ accounts: { AAA: KEY } });
  const line = buildLine({
    account: 'AAA',
    key: KEY,
    sequence: '0007',
    content: '|Nri2/CL5]',
    timestamp: at(3),
  });
  const result = r.receive(line);
  const reply = parseReply(result.reply, KEY);
  assert.equal(reply.verdict, 'ACK');
  assert.equal(reply.encrypted, true);
  assert.equal(reply.sequence, '0007');
  assert.equal(reply.crcOk, true);
  assert.equal(reply.plain, `00000000000]${siaTimestamp(NOW)}`);
  assert.deepEqual(result.message.events, [{ code: 'CL', number: 5, group: 2 }]);
  assert.equal(result.message.encrypted, true);
});

test("pysiaalarm's encrypted NULL (pad without |) is acknowledged", () => {
  const r = receiver({ accounts: { AAAB: KEY }, timeSkew: 0 });
  const result = r.receive(LINES.nullEncrypted.line);
  assert.equal(parseReply(result.reply, KEY).verdict, 'ACK');
  assert.equal(result.message.id, 'NULL');
  assert.deepEqual(result.message.events, []);
  assert.equal(result.message.timestamp, '2020-07-05T18:24:52.000Z');
});

test('the pysiaalarm samples with a right CRC are acknowledged (no clock check)', () => {
  const r = receiver({
    accounts: { AAA: null, 1111: null, '4F39': null, '006969': null },
    timeSkew: 0,
  });
  for (const name of ['admCid2', 'codeJc', 'xdataM', 'xdataK', 'xdataXY', 'cl', 'xc']) {
    const result = r.receive(LINES[name].line);
    assert.equal(parseReply(result.reply).verdict, 'ACK', `${name}: ${result.problem}`);
    assert.ok(result.message.events.length > 0, name);
  }
});

test('a wrong CRC is a NAK with our timestamp', () => {
  const result = receiver({ accounts: { AAA: null } }).receive(LINES.clBadCrc.line);
  const reply = parseReply(result.reply);
  assert.equal(reply.verdict, 'NAK');
  assert.equal(reply.sequence, '0000');
  assert.equal(reply.timestamp, siaTimestamp(NOW).slice(1));
  assert.equal(result.reason, 'crc');
});

test('not DC-09 at all: no reply', () => {
  const result = receiver().receive('GET / HTTP/1.1');
  assert.equal(result.reply, null);
  assert.equal(result.reason, 'format');
});

test('unknown account: NAK, reported with the account', () => {
  const result = receiver().receive(buildLine({ account: '9999', timestamp: at(0) }));
  assert.equal(parseReply(result.reply).verdict, 'NAK');
  assert.equal(result.reason, 'unknown_account');
  assert.equal(result.account, '9999');
  assert.match(result.problem, /add it to the configuration/);
});

test('encryption mismatches are NAKed', () => {
  // Encrypted, no key configured.
  let result = receiver().receive(buildLine({ account: '1234', key: KEY, timestamp: at(0) }));
  assert.equal(result.reason, 'no_key');
  // Encrypted with another key.
  result = receiver({ accounts: { 1234: Buffer.from('BBBBBBBBBBBBBBBB') } }).receive(
    buildLine({ account: '1234', key: KEY, timestamp: at(0) }),
  );
  assert.equal(result.reason, 'key');
  assert.equal(parseReply(result.reply).verdict, 'NAK');
  // Plain text while a key is configured.
  result = receiver({ accounts: { 1234: KEY } }).receive(
    buildLine({ account: '1234', timestamp: at(0) }),
  );
  assert.equal(result.reason, 'unencrypted');
  assert.equal(parseReply(result.reply).verdict, 'NAK');
});

test('the clock check: within the skew ACK, outside NAK, 0 disables it', () => {
  assert.equal(
    receiver().receive(buildLine({ account: '1234', timestamp: at(-59) })).reason,
    undefined,
  );
  assert.equal(
    receiver().receive(buildLine({ account: '1234', timestamp: at(61) })).reason,
    'timestamp',
  );
  assert.equal(
    receiver().receive(buildLine({ account: '1234', timestamp: at(-3600) })).reason,
    'timestamp',
  );
  assert.equal(
    receiver({ timeSkew: 0 }).receive(buildLine({ account: '1234', timestamp: at(-3600) })).reason,
    undefined,
  );
  // No timestamp at all: accepted (unencrypted panels may not send one).
  assert.equal(
    receiver().receive(buildLine({ account: '1234', timestamp: null })).reason,
    undefined,
  );
  // A timestamp that is not a date.
  const bad = receiver().receive(buildLine({ account: '1234', timestamp: '_99:99:99,13-45-2026' }));
  assert.equal(bad.reason, 'timestamp');
});

test('a message type we do not read: DUH', () => {
  const result = receiver().receive(
    buildLine({ account: '1234', type: 'SIA-DC3', timestamp: at(0) }),
  );
  assert.equal(parseReply(result.reply).verdict, 'DUH');
  assert.equal(result.reason, 'unsupported');
});

test('a data block we cannot read: DUH', () => {
  const result = receiver().receive(
    buildLine({ account: '1234', content: '|N!!!]', timestamp: at(0) }),
  );
  const reply = parseReply(result.reply);
  assert.equal(reply.verdict, 'DUH');
  assert.equal(reply.account, '1234');
  assert.equal(result.reason, 'data');
});

test('accounts differing between the header and the data: NAK', () => {
  const result = receiver({ accounts: { 1234: null, 5678: null } }).receive(
    buildLine({ account: '1234', content: '|#5678|Nri1/CL1]', timestamp: at(0) }),
  );
  assert.equal(result.reason, 'account_mismatch');
});

test('the account may come in the data only', () => {
  const result = receiver({ accounts: { '006969': null }, timeSkew: 0 }).receive(
    '39D5002E"SIA-DCS"4738R0001L0001[#006969|Nri04/OP001NM]',
  );
  const reply = parseReply(result.reply);
  assert.equal(reply.verdict, 'ACK');
  assert.equal(reply.account, '006969');
  assert.equal(reply.receiver, 'R0001');
  assert.equal(result.message.account, '006969');
});

test('a repeat (same sequence and content) is acknowledged but flagged', () => {
  const r = receiver();
  const line = buildLine({
    account: '1234',
    sequence: '0100',
    content: '|Nri1/BA3]',
    timestamp: at(0),
  });
  assert.equal(r.receive(line).message.duplicate, false);
  const again = r.receive(line);
  assert.equal(parseReply(again.reply).verdict, 'ACK');
  assert.equal(again.message.duplicate, true);
  // The next sequence is new; link tests (0000) never count as repeats.
  const next = buildLine({
    account: '1234',
    sequence: '0101',
    content: '|Nri1/BA3]',
    timestamp: at(0),
  });
  assert.equal(r.receive(next).message.duplicate, false);
  const ping = buildLine({
    account: '1234',
    type: 'NULL',
    sequence: '0000',
    content: ']',
    timestamp: at(0),
  });
  assert.equal(r.receive(ping).message.duplicate, false);
  assert.equal(r.receive(ping).message.duplicate, false);
});

test('a NULL link test is acknowledged with no event', () => {
  const result = receiver().receive(
    buildLine({ account: '1234', type: 'NULL', sequence: '0000', content: ']', timestamp: at(0) }),
  );
  assert.equal(parseReply(result.reply).verdict, 'ACK');
  assert.deepEqual(result.message.events, []);
});
