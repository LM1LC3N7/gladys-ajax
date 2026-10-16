// -----------------------------------------------------------------------------
// A small SIA DC-09 transmitter, the panel's side, written independently of
// src/sia (it shares no code with it) after pysiaalarm's test encoder
// (tests/test_utils.py, MIT, see THIRD_PARTY_NOTICES.md): CRC computed bit by
// bit, content `|Nri<group>/<code><number>]_timestamp`, encryption pads the
// content with `0` in front of the `|`. Used by the unit tests and by the
// end-to-end check against the real receiver container (e2e/).
// -----------------------------------------------------------------------------

import { createCipheriv, createDecipheriv } from 'node:crypto';
import { createConnection } from 'node:net';
import { createSocket } from 'node:dgram';

/** pysiaalarm's crc_calc, transcribed. */
export function crcCalc(message) {
  let crc = 0;
  for (const letter of Buffer.from(message, 'latin1')) {
    let temp = letter;
    for (let i = 0; i < 8; i++) {
      temp ^= crc & 1;
      crc >>= 1;
      if ((temp & 1) !== 0) {
        crc ^= 0xa001;
      }
      temp >>= 1;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const pad2 = (n) => String(n).padStart(2, '0');

export function siaTimestamp(date = new Date()) {
  return `_${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())},${pad2(
    date.getUTCMonth() + 1,
  )}-${pad2(date.getUTCDate())}-${date.getUTCFullYear()}`;
}

const cipher = (key) => `aes-${key.length * 8}-cbc`;

/** pysiaalarm's _encrypt_content: `0` x (16 - len % 16) then the content, AES-CBC zero IV, hex. */
export function encryptContent(key, content) {
  const extra = content.length % 16;
  const plain = '0'.repeat(16 - extra) + content;
  const aes = createCipheriv(cipher(key), key, Buffer.alloc(16));
  aes.setAutoPadding(false);
  return Buffer.concat([aes.update(plain, 'latin1'), aes.final()])
    .toString('hex')
    .toUpperCase();
}

export function decryptHex(key, hex) {
  const aes = createDecipheriv(cipher(key), key, Buffer.alloc(16));
  aes.setAutoPadding(false);
  return Buffer.concat([aes.update(Buffer.from(hex, 'hex')), aes.final()]).toString('latin1');
}

/**
 * One message as a panel sends it, without <LF>/<CR>.
 * @param {object} options
 * @param {string} options.account
 * @param {Buffer} [options.key] encrypts when given
 * @param {string} [options.content] the data block from `|`, e.g. `|Nri1/BA3]` (timestamp appended)
 */
export function buildLine({
  account,
  key,
  type = 'SIA-DCS',
  sequence = '0001',
  receiver = '',
  line = 'L0',
  content = '|Nri1/CL1]',
  timestamp = siaTimestamp(),
  alterCrc = false,
}) {
  const data = `${content}${timestamp ?? ''}`;
  const body = `"${key ? '*' : ''}${type}"${sequence}${receiver}${line}#${account}[${
    key ? encryptContent(key, data) : data
  }`;
  const crc = alterCrc ? (crcCalc(body) === '0000' ? '0001' : '0000') : crcCalc(body);
  return `${crc}${body.length.toString(16).toUpperCase().padStart(4, '0')}${body}`;
}

export const frame = (line) => `\n${line}\r`;

/**
 * A reply of the receiver -> its parts; `timestamp` and `plain` when an encrypted ACK is decrypted.
 */
export function parseReply(reply, key) {
  const text = reply.replace(/^\n/, '').replace(/\r$/, '');
  const match =
    /^([0-9A-F]{4})([0-9A-F]{4})("(\*?)(ACK|NAK|DUH)"(\d{4})(R[0-9A-F]+)?(L[0-9A-F]+)?(?:#([0-9A-F]*)|A0)?\[(.*))$/.exec(
      text,
    );
  if (!match) {
    return { verdict: null, text };
  }
  const [, crc, length, body, star, verdict, sequence, receiver, line, account, rest] = match;
  const result = {
    verdict,
    encrypted: star === '*',
    sequence,
    receiver: receiver ?? '',
    line: line ?? '',
    account: account ?? '',
    crcOk: crc === crcCalc(body),
    lengthOk: parseInt(length, 16) === body.length,
    rest,
  };
  if (result.encrypted && key) {
    result.plain = decryptHex(key, rest);
  }
  const ts = /_(\d{2}:\d{2}:\d{2},\d{2}-\d{2}-\d{4})/.exec(result.plain ?? rest);
  if (ts) {
    result.timestamp = ts[1];
  }
  return result;
}

/** Sends messages over one TCP connection, resolves with the replies (one per message). */
export function sendTcp(host, port, lines, { timeout = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const replies = [];
    let buffer = '';
    const socket = createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`TCP: ${replies.length}/${lines.length} replies after ${timeout} ms`));
    }, timeout);
    socket.setEncoding('latin1');
    socket.on('connect', () => socket.write(lines.map(frame).join(''), 'latin1'));
    socket.on('data', (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\r')) >= 0) {
        replies.push(buffer.slice(0, end + 1));
        buffer = buffer.slice(end + 1);
      }
      if (replies.length >= lines.length) {
        clearTimeout(timer);
        socket.end();
        resolve(replies);
      }
    });
    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Sends one message in one datagram, resolves with the reply. */
export function sendUdp(host, port, line, { timeout = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4');
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`UDP: no reply after ${timeout} ms`));
    }, timeout);
    socket.on('message', (data) => {
      clearTimeout(timer);
      socket.close();
      resolve(data.toString('latin1'));
    });
    socket.send(Buffer.from(frame(line), 'latin1'), port, host, (err) => {
      if (err) {
        clearTimeout(timer);
        socket.close();
        reject(err);
      }
    });
  });
}
