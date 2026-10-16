import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDataBlock } from '../src/sia/content.js';
import { AJAX_DECRYPTED } from './fixtures/frames.js';

const block = (line) => line.slice(line.indexOf('[') + 1);

test('Ajax data blocks: account, group, code and number, timestamp', () => {
  const night = parseDataBlock(
    AJAX_DECRYPTED[1].slice(AJAX_DECRYPTED[1].indexOf('|') + 1),
    'SIA-DCS',
  );
  assert.equal(night.account, 'EA1984');
  assert.deepEqual(night.events, [{ code: 'NL', number: 4, group: 1 }]);
  assert.equal(night.timestamp.toISOString(), '2021-01-07T08:38:13.000Z');

  const test = parseDataBlock(
    AJAX_DECRYPTED[0].slice(AJAX_DECRYPTED[0].indexOf('|') + 1),
    'SIA-DCS',
  );
  assert.deepEqual(test.events, [{ code: 'RP', number: 0, group: 0 }]);
});

test('the forms pysiaalarm met on real panels', () => {
  const cases = [
    [
      '#123456|Nri1CL0^VX FRONTE ^]_22:40:48,04-11-2021',
      [{ code: 'CL', number: 0, group: 1, text: 'VX FRONTE' }],
    ],
    [
      '#123456|Nri0KR1^TAST. 001 ^]_13:49:12,04-13-2021',
      [{ code: 'KR', number: 1, group: 0, text: 'TAST. 001' }],
    ],
    ['|Nri2/JC12]_12:58:23,09-15-2021', [{ code: 'JC', number: 12, group: 2 }]],
    ['#006969|Nri04/OP001NM]', [{ code: 'OP', number: 1, group: 4, text: 'NM' }]],
    ['Nri1/WA000]_08:40:47,07-08-2020', [{ code: 'WA', number: 0, group: 1 }]],
    ['#3080|Nti19:44/id1/ri4/RP]', [{ code: 'RP', group: 4, user: 1, time: '19:44' }]],
    ['#AAA|Nri1/XC12]', [{ code: 'XC', number: 12, group: 1 }]],
    ['|NL4]', [{ code: 'NL', number: 4 }]],
    [
      '#1234|Nri1/BA12/BA13]',
      [
        { code: 'BA', number: 12, group: 1 },
        { code: 'BA', number: 13, group: 1 },
      ],
    ],
    ['#1234|Nri1/PA2*Panic button]', [{ code: 'PA', number: 2, group: 1, text: 'Panic button' }]],
  ];
  for (const [text, events] of cases) {
    assert.deepEqual(parseDataBlock(text, 'SIA-DCS').events, events, text);
  }
});

test('extended data and account in the data', () => {
  const parsed = parseDataBlock(
    block(
      '"SIA-DCS"0004L0#1111[#1111|Nri1/PA501][X006E07.7777777][Y49N06.6666666]_20:45:46,04-22-2021',
    ),
    'SIA-DCS',
  );
  assert.equal(parsed.account, '1111');
  assert.deepEqual(parsed.xdata, [
    { id: 'X', value: '006E07.7777777' },
    { id: 'Y', value: '49N06.6666666' },
  ]);
  assert.equal(parsed.timestampText, '20:45:46,04-22-2021');
  assert.deepEqual(parsed.events, [{ code: 'PA', number: 501, group: 1 }]);
});

test('ADM-CID (Contact ID) through pysiaalarm mapping', () => {
  assert.deepEqual(parseDataBlock('#12345A|1110 00 129]_14:12:04,09-25-2011', 'ADM-CID').events, [
    { code: 'FA', number: 129, group: 0, cid: '1110' },
  ]);
  assert.deepEqual(parseDataBlock('#4F39|3401 01 057]', 'ADM-CID').events, [
    { code: 'CL', number: 57, group: 1, cid: '3401' },
  ]);
  assert.deepEqual(parseDataBlock('#4F39|1401 02 003]', 'ADM-CID').events[0].code, 'OP');
  assert.equal(parseDataBlock('#123|1999 00 001]', 'ADM-CID').events[0].code, 'YN');
});

test('link tests: empty data, NULL', () => {
  assert.deepEqual(parseDataBlock(']_18:24:52,07-05-2020', 'NULL').events, []);
  assert.deepEqual(parseDataBlock('#0000|0000 00 000]_22:13:29,12-29-2022', 'NULL').events, []);
  assert.deepEqual(parseDataBlock('#1234|]', 'SIA-DCS').events, []);
});

test('unreadable data throws (the reply is then DUH)', () => {
  assert.throws(() => parseDataBlock('#1234|Nri1/BA3', 'SIA-DCS'), /Unterminated/);
  assert.throws(() => parseDataBlock('#1234|N!!!]', 'SIA-DCS'), /Unreadable/);
  assert.throws(() => parseDataBlock('#1234|garbage]', 'ADM-CID'), /Unreadable/);
});
