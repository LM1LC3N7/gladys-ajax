// -----------------------------------------------------------------------------
// The receiver's decision for one message, pure and transport-agnostic:
// validate it, then build the reply the panel expects.
//
//   - not DC-09 at all -> no reply; looks like DC-09 but unreadable -> NAK;
//   - CRC mismatch, unknown account, missing or wrong key, unencrypted message
//     on an account with a key, timestamp outside the allowed skew -> NAK
//     (with our timestamp: the panel can set its clock and resend);
//   - a message type or data block we cannot read -> DUH (do not resend);
//   - otherwise ACK (encrypted when the message was), and the events.
//
// A panel resends a message whose ACK it did not get, with the same sequence
// number: such a repeat is acknowledged again but flagged `duplicate`, so the
// events are not counted twice.
// -----------------------------------------------------------------------------

import { parseDataBlock } from './content.js';
import {
  FrameError,
  buildFrame,
  decryptBody,
  encryptBody,
  formatTimestamp,
  parseFrame,
} from './frame.js';

export const SUPPORTED_IDS = ['SIA-DCS', 'ADM-CID', 'NULL'];

/** A repeat within this delay, same account, sequence and content, is a duplicate. */
const DUPLICATE_WINDOW_MS = 5 * 60_000;

export class SiaReceiver {
  /**
   * @param {object} options
   * @param {Map<string, {key: Buffer|null}>} options.accounts account (upper case) -> its key
   * @param {number} options.timeSkew allowed clock difference in seconds, 0 = not checked
   * @param {() => Date} [options.now]
   */
  constructor({ accounts, timeSkew = 0, now = () => new Date() }) {
    this.accounts = accounts;
    this.timeSkew = timeSkew;
    this.now = now;
    this.lastSeen = new Map();
  }

  /**
   * @param {string} line one message without its <LF> and <CR>
   * @returns {{ reply: string|null, message?: object, problem?: string, reason?: string, account?: string }}
   */
  receive(line) {
    const now = this.now();
    let frame;
    try {
      frame = parseFrame(line);
    } catch (err) {
      // Something that is not DC-09 at all (a port scan, a browser) gets nothing.
      const looksLikeSia =
        err instanceof FrameError && (err.reason === 'crc' || line.includes('"'));
      return this.refuse(looksLikeSia ? this.nak(now) : null, err.reason, err.message);
    }

    if (!SUPPORTED_IDS.includes(frame.id)) {
      return this.refuse(
        this.respond('DUH', frame, frame.account, now),
        'unsupported',
        `Unsupported message type ${frame.id} (choose SIA-DCS on the panel)`,
        frame.account,
      );
    }

    // The account comes from the header; an unencrypted message may carry it in its data only.
    let account = frame.account;
    let content;
    if (frame.encrypted) {
      const entry = this.accounts.get(account);
      if (!entry) {
        return this.unknownAccount(account, now);
      }
      if (!entry.key) {
        return this.refuse(
          this.nak(now),
          'no_key',
          `Encrypted message from account ${account}, but no encryption key is configured`,
          account,
        );
      }
      try {
        content = decryptBody(frame.body, entry.key);
      } catch (err) {
        return this.refuse(this.nak(now), 'key', `Account ${account}: ${err.message}`, account);
      }
    } else {
      content = frame.body;
    }

    let block;
    try {
      block = parseDataBlock(content, frame.id);
    } catch (err) {
      return this.refuse(this.respond('DUH', frame, account, now), 'data', err.message, account);
    }

    if (block.account && account && block.account !== account) {
      return this.refuse(
        this.nak(now),
        'account_mismatch',
        `Account ${block.account} in the data, ${account} in the header`,
        account,
      );
    }
    account ||= block.account ?? '';
    const entry = this.accounts.get(account);
    if (!entry) {
      return this.unknownAccount(account, now);
    }
    if (entry.key && !frame.encrypted) {
      return this.refuse(
        this.nak(now),
        'unencrypted',
        `Unencrypted message from account ${account}, which has an encryption key: refused`,
        account,
      );
    }

    if (this.timeSkew > 0 && block.timestampText) {
      const skew = block.timestamp ? (block.timestamp.getTime() - now.getTime()) / 1000 : NaN;
      if (!(Math.abs(skew) <= this.timeSkew)) {
        return this.refuse(
          this.nak(now),
          'timestamp',
          `Account ${account}: timestamp ${block.timestampText} is ${
            Number.isNaN(skew) ? 'invalid' : `${Math.round(skew)} s off`
          } (allowed ${this.timeSkew} s): check the clock of the panel`,
          account,
        );
      }
    }

    return {
      reply: this.respond('ACK', frame, account, now),
      account,
      message: {
        account,
        id: frame.id,
        sequence: frame.sequence,
        receiver: frame.receiver,
        line: frame.line,
        encrypted: frame.encrypted,
        timestamp: block.timestamp?.toISOString() ?? null,
        events: block.events,
        xdata: block.xdata,
        duplicate: this.isDuplicate(account, frame, content, now),
        lengthOk: frame.lengthOk,
      },
    };
  }

  isDuplicate(account, frame, content, now) {
    if (frame.sequence === '0000') {
      return false;
    }
    const key = `${account}:${frame.line}`;
    const previous = this.lastSeen.get(key);
    this.lastSeen.set(key, { sequence: frame.sequence, content, at: now.getTime() });
    return (
      previous !== undefined &&
      previous.sequence === frame.sequence &&
      previous.content === content &&
      now.getTime() - previous.at <= DUPLICATE_WINDOW_MS
    );
  }

  unknownAccount(account, now) {
    return this.refuse(
      this.nak(now),
      'unknown_account',
      account
        ? `Unknown account ${account}: add it to the configuration`
        : 'Message without an account number',
      account,
    );
  }

  refuse(reply, reason, problem, account) {
    return { reply, reason, problem, ...(account ? { account } : {}) };
  }

  /** ACK or DUH: `"ACK"seq[R]L#acct[]`, the ACK of an encrypted message encrypted too. */
  respond(verdict, frame, account, now) {
    const encrypt = verdict === 'ACK' && frame.encrypted;
    const head = `"${encrypt ? '*' : ''}${verdict}"${frame.sequence}${frame.receiver}${frame.line}#${account ?? ''}[`;
    if (encrypt) {
      const { key } = this.accounts.get(account);
      return buildFrame(head + encryptBody(`]${formatTimestamp(now)}`, key));
    }
    return buildFrame(`${head}]`);
  }

  /** The DC-09 NAK, with the receiver's time. */
  nak(now) {
    return buildFrame(`"NAK"0000R0L0A0[]${formatTimestamp(now)}`);
  }
}
