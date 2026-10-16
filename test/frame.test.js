import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFrame,
  crc16,
  decryptBody,
  encryptBody,
  formatTimestamp,
  hex4,
  parseFrame,
  parseKey,
  parseTimestamp,
} from '../src/sia/frame.js';
import { LINES, PYSIA_KEY } from './fixtures/frames.js';
import { crcCalc, decryptHex, encryptContent } from './helpers/siaClient.js';

const key = Buffer.from(PYSIA_KEY, 'latin1');

test('crc16 is CRC-16/ARC, as pysiaalarm computes it', () => {
  assert.equal(hex4(crc16('123456789')), 'BB3D'); // the CRC-16/ARC check value
  for (const [name, { line, crc }] of Object.entries(LINES)) {
    if (!line.includes('"')) continue;
    assert.equal(hex4(crc16(line.slice(8))) === line.slice(0, 4), crc, name);
    assert.equal(hex4(crc16(line.slice(8))), crcCalc(line.slice(8)), name);
  }
});

test('parseFrame reads the header of the pysiaalarm samples', () => {
  const op = parseFrame('39D5002E"SIA-DCS"4738R0001L0001[#006969|Nri04/OP001NM]');
  assert.deepEqual(op, {
    id: 'SIA-DCS',
    encrypted: false,
    sequence: '4738',
    receiver: 'R0001',
    line: 'L0001',
    account: '',
    body: '#006969|Nri04/OP001NM]',
    lengthOk: true,
  });
  const cl = parseFrame(LINES.cl.line);
  assert.equal(cl.account, 'AAA');
  assert.equal(cl.receiver, '');
  assert.equal(cl.lengthOk, false, 'pysiaalarm writes 0078 for a 52-character message');
  const encrypted = parseFrame(LINES.nullEncrypted.line);
  assert.equal(encrypted.id, 'NULL');
  assert.equal(encrypted.encrypted, true);
  assert.equal(encrypted.account, 'AAAB');
});

test('parseFrame refuses a wrong CRC and what is not DC-09', () => {
  assert.throws(() => parseFrame(LINES.clBadCrc.line), { reason: 'crc' });
  assert.throws(() => parseFrame(LINES.formatError.line), { reason: 'format' });
  assert.throws(() => parseFrame('GET / HTTP/1.1'), { reason: 'format' });
});

test('buildFrame: <LF> CRC length region <CR>', () => {
  const region = '"ACK"0001L0#1234[]';
  const framed = buildFrame(region);
  assert.equal(framed, `\n${crcCalc(region)}0012${region}\r`);
});

test('timestamps are UTC _HH:MM:SS,MM-DD-YYYY', () => {
  const date = new Date(Date.UTC(2026, 9, 16, 7, 5, 9));
  assert.equal(formatTimestamp(date), '_07:05:09,10-16-2026');
  assert.equal(parseTimestamp('07:05:09,10-16-2026').getTime(), date.getTime());
  assert.equal(parseTimestamp('25:00:00,10-16-2026'), undefined);
  assert.equal(parseTimestamp('10:00:00,02-30-2026'), undefined);
  assert.equal(parseTimestamp('nope'), undefined);
});

test('decryptBody drops the pad, with or without the |', () => {
  const plain = decryptBody(
    LINES.nullEncrypted.line.slice(LINES.nullEncrypted.line.indexOf('[') + 1),
    key,
  );
  assert.equal(plain, ']_18:24:52,07-05-2020');
  const hex = encryptContent(key, '|#1234|Nri1/BA3]_10:00:00,10-16-2026');
  assert.equal(decryptBody(hex, key), '#1234|Nri1/BA3]_10:00:00,10-16-2026');
});

test('decryptBody detects a wrong key', () => {
  const hex = LINES.encrypted.line.slice(LINES.encrypted.line.indexOf('[') + 1);
  assert.throws(() => decryptBody(hex, key), { reason: 'crypto' });
  const other = encryptContent(key, '|#1234|Nri1/BA3]_10:00:00,10-16-2026');
  assert.throws(() => decryptBody(other, Buffer.from('BBBBBBBBBBBBBBBB')), { reason: 'crypto' });
  assert.throws(() => decryptBody('ABC', key), { reason: 'crypto' });
});

test('encryptBody pads with 0 to the next block, as pysiaalarm answers', () => {
  const hex = encryptBody(']_10:00:00,10-16-2026', key);
  assert.equal(hex.length, 64);
  assert.equal(decryptHex(key, hex), '00000000000]_10:00:00,10-16-2026');
  // A multiple of 16 still gets a full block of pad.
  assert.equal(decryptHex(key, encryptBody('x'.repeat(16), key)).length, 32);
});

test('AES-192 and AES-256 keys work too', () => {
  for (const length of [24, 32]) {
    const longKey = Buffer.from('K'.repeat(length));
    const hex = encryptContent(longKey, '|Nri1/CL1]');
    assert.equal(decryptBody(hex, longKey), 'Nri1/CL1]');
  }
});

test('parseKey: ASCII or hexadecimal, as the Ajax app accepts them', () => {
  assert.equal(parseKey(''), null);
  assert.equal(parseKey('  '), null);
  assert.deepEqual(parseKey('0123456789abcdef'), Buffer.from('0123456789abcdef', 'latin1'));
  assert.deepEqual(
    parseKey('000102030405060708090A0B0C0D0E0F'),
    Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex'),
  );
  assert.equal(parseKey('000102030405060708090A0B0C0D0E0F', 'ascii').length, 32);
  assert.equal(parseKey('k'.repeat(24)).length, 24);
  assert.equal(parseKey('k'.repeat(32)).length, 32);
  assert.throws(() => parseKey('short'), /16, 24 or 32/);
  assert.throws(() => parseKey('k'.repeat(16), 'hex'), /hexadecimal/);
  assert.throws(() => parseKey('é'.repeat(8) + '€'.repeat(8)), /16, 24 or 32/);
});
