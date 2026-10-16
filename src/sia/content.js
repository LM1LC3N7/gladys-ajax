// -----------------------------------------------------------------------------
// The data block of a message (what follows `[`, or the decrypted text after
// the pad), pure:
//
//   #ACCT|Nri1/CL501][xdata][xdata]_14:12:04,09-25-2019     SIA-DCS
//   #ACCT|1401 01 012]_14:12:04,09-25-2019                 ADM-CID (Contact ID)
//   ]_14:12:04,09-25-2019                                   NULL (link test)
//
// SIA-DCS events: `N` (new event), then `/`-separated fields and events:
// `ri<n>` the area (an Ajax group), `id<n>` the user, `ti<hh:mm>` the time,
// then a two-letter code and its number (`BA12`: burglary, zone 12; `CL5`:
// armed by user 5), optionally a text between `^` or after `*`. The forms
// pysiaalarm meets on real panels are accepted too: no `/` before the code
// (`Nri1CL0^VX FRONTE ^`), no number (`Nti19:44/id1/ri4/RP`), no `N`.
// -----------------------------------------------------------------------------

import { ADM_MAPPING } from './codes.js';
import { parseTimestamp } from './frame.js';

const ACCOUNT = /^#([0-9A-Fa-f]{3,16})\|?/;
const TIMESTAMP = /_(\d{2}:\d{2}:\d{2},\d{2}-\d{2}-\d{4})/;
const ADM = /^(\d)(\d{3}) (\d{2}) (\d{3})/;

const toNumber = (digits) => (digits === '' ? undefined : Number(digits));

function withoutUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

/** One SIA-DCS event list (after the `N`). Returns undefined when nothing can be read. */
function parseSiaEvents(text) {
  const events = [];
  const fields = {};
  for (const token of text.split('/')) {
    let rest = token;
    while (rest !== '') {
      let match;
      if ((match = /^ti(\d{1,2}:\d{2}(?::\d{2})?)/.exec(rest))) {
        fields.time = match[1];
      } else if ((match = /^(ri|id|pi)(\d*)/.exec(rest))) {
        const key = { ri: 'group', id: 'user', pi: 'peripheral' }[match[1]];
        fields[key] = toNumber(match[2]);
      } else if ((match = /^([A-Z]{2})(\d*)/.exec(rest))) {
        const event = withoutUndefined({
          code: match[1],
          number: toNumber(match[2]),
          group: fields.group,
          user: fields.user,
          time: fields.time,
        });
        rest = rest.slice(match[0].length);
        // A text: `^…^`, `*…`, or what is left that does not start another event.
        const text = /^\^([^^]*)\^?/.exec(rest) ?? /^\*(.*)$/.exec(rest);
        if (text) {
          event.text = text[1].trim();
          rest = rest.slice(text[0].length);
        } else if (rest !== '' && !/^[A-Z]{2}\d/.test(rest)) {
          event.text = rest.trim();
          rest = '';
        }
        if (event.text === '') {
          delete event.text;
        }
        events.push(event);
        continue;
      } else {
        return undefined;
      }
      rest = rest.slice(match[0].length);
    }
  }
  return events;
}

/** ADM-CID `QEEE GG ZZZ` -> one event with its SIA code (pysiaalarm's mapping, `YN` when unknown). */
function parseAdmEvent(text) {
  const match = ADM.exec(text);
  if (!match) {
    return undefined;
  }
  const [, qualifier, type, group, number] = match;
  return [
    {
      code: ADM_MAPPING[type]?.[qualifier] ?? 'YN',
      number: Number(number),
      group: Number(group),
      cid: `${qualifier}${type}`,
    },
  ];
}

/**
 * @param {string} block the data block, from after `[` (plain) or after the pad `|` (decrypted)
 * @param {string} id `SIA-DCS`, `ADM-CID` or `NULL`
 * @returns {{ account?, events, xdata, timestamp?, timestampText? }}
 * @throws {Error} when the block cannot be read (the reply is then DUH)
 */
export function parseDataBlock(block, id) {
  const end = block.indexOf(']');
  if (end < 0) {
    throw new Error('Unterminated data block');
  }
  // A pad separator may be left in front (`|#ACCT|N…`, `|N…`).
  let head = block.slice(0, end).replace(/^\|/, '');
  const tail = block.slice(end + 1);
  const result = { events: [], xdata: [] };

  const account = ACCOUNT.exec(head);
  if (account) {
    result.account = account[1].toUpperCase();
    head = head.slice(account[0].length);
  }
  head = head.replace(/^\|/, '');

  // Extended data blocks `[Xvalue]` right after the data, then the timestamp.
  let rest = tail;
  let xdata;
  while ((xdata = /^\[([^\]]*)\]/.exec(rest))) {
    if (xdata[1] !== '') {
      result.xdata.push({ id: xdata[1][0], value: xdata[1].slice(1) });
    }
    rest = rest.slice(xdata[0].length);
  }
  const timestamp = TIMESTAMP.exec(rest);
  if (timestamp) {
    result.timestampText = timestamp[1];
    result.timestamp = parseTimestamp(timestamp[1]);
  }

  if (id === 'NULL' || head.trim() === '') {
    return result;
  }
  let events;
  if (id === 'ADM-CID') {
    events = parseAdmEvent(head);
  } else {
    // `N` = new event. Try without it first (`Nri1/…`), then the whole text (`NL4`).
    events = /^[NO]/.test(head) && head.length > 1 ? parseSiaEvents(head.slice(1)) : undefined;
    if (!events?.length) {
      events = parseSiaEvents(head);
    }
  }
  if (!events?.length) {
    throw new Error(`Unreadable data: ${head.slice(0, 60)}`);
  }
  result.events = events;
  return result;
}
