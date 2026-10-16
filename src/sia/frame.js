// -----------------------------------------------------------------------------
// SIA DC-09 wire format (ANSI/SIA DC-09), as the Ajax hubs send it:
//
//   <LF> CRC LLLL "ID" seq [Rrcvr] Lpref [#acct] [ data ... ] [_timestamp] <CR>
//
// - CRC: 4 hex digits, CRC-16/ARC of everything from the first `"` to the end
//   (the <CR> excluded); LLLL: 4 hex digits, the length of that same part;
// - "ID": `SIA-DCS`, `ADM-CID` or `NULL` (link test), `*` in front when the
//   data block is encrypted: AES-CBC with a zero IV, sent as hex, whose
//   plaintext is `<pad>|<data>` (the pad, random characters, is dropped);
// - replies: `"ACK"`, `"NAK"` (with the receiver's timestamp, so a panel can
//   set its clock), `"DUH"` (not understood).
//
// The CRC, the AES handling and the reply forms follow pysiaalarm and
// homebridge-ajax-sia (both MIT, see THIRD_PARTY_NOTICES.md), which work with
// real Ajax hubs: the encrypted ACK is `]_timestamp` left-padded with `0` to a
// multiple of 16, without the `|` separator, as both send it.
// -----------------------------------------------------------------------------

import { createCipheriv, createDecipheriv } from 'node:crypto';

/** Why a line was refused: drives the reply (NAK, DUH or nothing). */
export class FrameError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = 'FrameError';
    this.reason = reason;
  }
}

const FRAME =
  /^([0-9A-Fa-f]{4})([0-9A-Fa-f]{4})"(\*?)([A-Za-z0-9-]{2,12})"(\d{4})(R[0-9A-Fa-f]{1,6})?(L[0-9A-Fa-f]{1,6})(?:#([0-9A-Fa-f]{3,16}))?\[([\s\S]*)$/;

const ZERO_IV = Buffer.alloc(16);

/** CRC-16/ARC (polynomial 0xA001 reflected, initial value 0) of a latin1 string. */
export function crc16(text) {
  let crc = 0;
  for (const byte of Buffer.from(text, 'latin1')) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
  }
  return crc;
}

export const hex4 = (value) => value.toString(16).toUpperCase().padStart(4, '0');

/**
 * One message, without its leading <LF> and trailing <CR>.
 * @returns {{ id, encrypted, sequence, receiver, line, account, body, lengthOk }}
 * @throws {FrameError} `format` (not DC-09) or `crc`
 */
export function parseFrame(text) {
  const match = FRAME.exec(text);
  if (!match) {
    throw new FrameError('Not a SIA DC-09 message', 'format');
  }
  const [, crc, length, star, id, sequence, receiver, line, account, body] = match;
  const region = text.slice(8);
  const expected = hex4(crc16(region));
  if (expected !== crc.toUpperCase()) {
    throw new FrameError(`CRC mismatch (got ${crc}, expected ${expected})`, 'crc');
  }
  return {
    id: id.toUpperCase(),
    encrypted: star === '*',
    sequence,
    receiver: receiver ?? '',
    line,
    account: (account ?? '').toUpperCase(),
    body,
    // Informative only: some panels (and pysiaalarm's own test lines) get it wrong.
    lengthOk: parseInt(length, 16) === region.length,
  };
}

/** Wraps the CRC-protected part of a reply into a message ready to send. */
export function buildFrame(region) {
  return `\n${hex4(crc16(region))}${hex4(region.length)}${region}\r`;
}

function cipherName(key) {
  switch (key?.length) {
    case 16:
      return 'aes-128-cbc';
    case 24:
      return 'aes-192-cbc';
    case 32:
      return 'aes-256-cbc';
    default:
      throw new FrameError(`Unsupported AES key length: ${key?.length} bytes`, 'crypto');
  }
}

/** An empty data block: `]`, extended data, a timestamp. */
const EMPTY_BLOCK = /^\](?:\[[^\]]*\])*_\d{2}:\d{2}:\d{2},\d{2}-\d{2}-\d{4}$/;

/**
 * The data block of an encrypted message: decrypts, then drops the pad up to
 * the first `|`. A link test may come without the `|` (pysiaalarm's real
 * `*NULL` sample: `ppppppppppp]_18:24:52,07-05-2020`): the pad then runs up
 * to the `]`. The data is printable ASCII: anything else is a wrong key.
 */
export function decryptBody(hex, key) {
  if (!/^(?:[0-9A-Fa-f]{32})+$/.test(hex)) {
    throw new FrameError('Malformed ciphertext', 'crypto');
  }
  const decipher = createDecipheriv(cipherName(key), key, ZERO_IV);
  decipher.setAutoPadding(false);
  const plain = Buffer.concat([decipher.update(Buffer.from(hex, 'hex')), decipher.final()])
    .toString('latin1')
    .replace(/\0+$/, '');
  const separator = plain.indexOf('|');
  const data = separator >= 0 ? plain.slice(separator + 1) : plain.slice(plain.indexOf(']'));
  const readable =
    plain.includes(']') &&
    /^[\x20-\x7e]*$/.test(data) &&
    (separator >= 0 || EMPTY_BLOCK.test(data));
  if (!readable) {
    throw new FrameError('Decryption failed (wrong key?)', 'crypto');
  }
  return data;
}

/** A reply payload, left-padded with `0` up to the next multiple of 16 (always 1 to 16 added). */
export function encryptBody(plain, key) {
  const padded = plain.padStart(plain.length + 16 - (plain.length % 16), '0');
  const cipher = createCipheriv(cipherName(key), key, ZERO_IV);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded, 'latin1'), cipher.final()])
    .toString('hex')
    .toUpperCase();
}

const two = (n) => String(n).padStart(2, '0');

/** `_HH:MM:SS,MM-DD-YYYY`, in UTC as DC-09 wants it. */
export function formatTimestamp(date) {
  return (
    `_${two(date.getUTCHours())}:${two(date.getUTCMinutes())}:${two(date.getUTCSeconds())},` +
    `${two(date.getUTCMonth() + 1)}-${two(date.getUTCDate())}-${date.getUTCFullYear()}`
  );
}

/** `HH:MM:SS,MM-DD-YYYY` (UTC) -> Date, undefined when not a real date. */
export function parseTimestamp(text) {
  const match = /^(\d{2}):(\d{2}):(\d{2}),(\d{2})-(\d{2})-(\d{4})$/.exec(String(text ?? ''));
  if (!match) {
    return undefined;
  }
  const [hh, mm, ss, month, day, year] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hh, mm, ss));
  return date.getUTCDate() === day && hh < 24 && mm < 60 && ss < 60 ? date : undefined;
}

/**
 * The key as typed by the user -> the AES key bytes.
 * - `ascii`: 16, 24 or 32 characters used as they are (Ajax "16 ASCII
 *   characters", and what pysiaalarm does with any key);
 * - `hex`: 32, 48 or 64 hexadecimal digits (Ajax "32 HEX");
 * - `auto`: 32, 48 or 64 hex digits are read as hex (the Ajax app's HEX form),
 *   16, 24 or 32 other characters as ASCII.
 * @returns {Buffer|null} null for an empty key
 * @throws {Error} for a key of another length
 */
export function parseKey(text, format = 'auto') {
  const key = String(text ?? '').trim();
  if (key === '') {
    return null;
  }
  const isHex = /^(?:[0-9A-Fa-f]{32}|[0-9A-Fa-f]{48}|[0-9A-Fa-f]{64})$/.test(key);
  if (format === 'hex' || (format === 'auto' && isHex)) {
    if (!isHex) {
      throw new Error('a hexadecimal key needs 32, 48 or 64 hexadecimal digits');
    }
    return Buffer.from(key, 'hex');
  }
  const bytes = Buffer.from(key, 'latin1');
  if (![16, 24, 32].includes(bytes.length) || bytes.toString('latin1') !== key) {
    throw new Error('the key needs 16, 24 or 32 characters (or 32, 48 or 64 hexadecimal digits)');
  }
  return bytes;
}
