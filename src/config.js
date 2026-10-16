// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized, and the
// environment of the receiver sub-container derived from it.
// -----------------------------------------------------------------------------

import { KEY_FORMATS, PING_INTERVAL, TIME_SKEW } from './constants.js';
import { parseKey } from './sia/frame.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  key_format: 'auto',
  time_skew: TIME_SKEW.default,
  ping_interval: PING_INTERVAL.default,
  language: 'fr',
};

export const LANGUAGES = ['fr', 'en'];

/** `1234, ab12 C0FFEE` -> ['1234', 'AB12', 'C0FFEE'] (3 to 16 hex digits), plus what was not valid. */
export function parseAccounts(text) {
  const valid = [];
  const invalid = [];
  for (const word of String(text ?? '')
    .split(/[\s,;]+/)
    .filter(Boolean)) {
    const account = word.replace(/^#/, '').toUpperCase();
    if (/^[0-9A-F]{3,16}$/.test(account)) {
      if (!valid.includes(account)) valid.push(account);
    } else {
      invalid.push(word);
    }
  }
  return { valid, invalid };
}

const bounded = (value, { default: fallback, min, max }) => {
  const number = Number(value);
  return value !== null && value !== '' && value !== undefined && Number.isFinite(number)
    ? Math.round(Math.max(min, Math.min(max, number)))
    : fallback;
};

export function normalizeConfig(raw = {}) {
  const { valid, invalid } = parseAccounts(raw?.accounts);
  const keyFormat = String(raw?.key_format ?? DEFAULTS.key_format)
    .trim()
    .toLowerCase();
  const format = KEY_FORMATS.includes(keyFormat) ? keyFormat : DEFAULTS.key_format;
  let key = null;
  let keyError = null;
  try {
    key = parseKey(raw?.encryption_key, format);
  } catch (err) {
    keyError = err.message;
  }
  const language = String(raw?.language ?? DEFAULTS.language)
    .trim()
    .toLowerCase();
  return {
    accounts: valid,
    invalidAccounts: invalid,
    key,
    keyError,
    keyFormat: format,
    timeSkew: bounded(raw?.time_skew, TIME_SKEW),
    pingInterval: bounded(raw?.ping_interval, PING_INTERVAL),
    language: LANGUAGES.includes(language) ? language : DEFAULTS.language,
  };
}

/**
 * The env of the receiver (see src/sia/service.js). The key travels as the hex
 * of its bytes, whatever form the user typed. A change recreates the container.
 */
export function receiverEnv(config, token, logLevel) {
  return {
    SIA_ACCOUNTS: JSON.stringify(
      config.accounts.map((account) => ({
        account,
        key: config.key ? config.key.toString('hex') : '',
      })),
    ),
    SIA_TIME_SKEW: String(config.timeSkew),
    CHANNEL_TOKEN: token,
    ...(logLevel ? { LOG_LEVEL: logLevel } : {}),
  };
}
