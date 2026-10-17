import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalizeConfig, parseAccounts, receiverEnv } from '../src/config.js';
import { parseAccountsEnv } from '../src/sia/service.js';

test('accounts: 3 to 16 hex digits, upper case, separators, duplicates', () => {
  assert.deepEqual(parseAccounts('1234, ab12;C0FFEE  #beef 1234 12 XYZW 12345678901234567'), {
    valid: ['1234', 'AB12', 'C0FFEE', 'BEEF'],
    invalid: ['12', 'XYZW', '12345678901234567'],
  });
  assert.deepEqual(parseAccounts(undefined), { valid: [], invalid: [] });
});

test('defaults and bounds', () => {
  const config = normalizeConfig({});
  assert.deepEqual(config.accounts, []);
  assert.equal(config.key, null);
  assert.equal(config.keyError, null);
  assert.equal(config.keyFormat, DEFAULTS.key_format);
  assert.equal(config.timeSkew, 60);
  assert.equal(config.pingInterval, 1);
  assert.equal(config.language, 'fr');
  const bounded = normalizeConfig({
    time_skew: 99999,
    ping_interval: -5,
    language: 'de',
    key_format: 'x',
  });
  assert.equal(bounded.timeSkew, 3600);
  assert.equal(bounded.pingInterval, 0);
  assert.equal(bounded.language, 'fr');
  assert.equal(bounded.keyFormat, 'auto');
  assert.equal(normalizeConfig({ ping_interval: '' }).pingInterval, 1);
  assert.equal(normalizeConfig({ time_skew: 0 }).timeSkew, 0);
});

test('the key, as typed, in each format', () => {
  assert.equal(normalizeConfig({ encryption_key: '0123456789abcdef' }).key.length, 16);
  const hex = normalizeConfig({ encryption_key: '00112233445566778899AABBCCDDEEFF' });
  assert.equal(hex.key.toString('hex'), '00112233445566778899aabbccddeeff');
  const ascii = normalizeConfig({
    encryption_key: '00112233445566778899AABBCCDDEEFF',
    key_format: 'ascii',
  });
  assert.equal(ascii.key.length, 32);
  const bad = normalizeConfig({ encryption_key: 'abc' });
  assert.equal(bad.key, null);
  assert.match(bad.keyError, /16, 24 or 32/);
});

test('the receiver env carries the key bytes as hex, read back by the receiver', () => {
  const config = normalizeConfig({
    accounts: '1234 AB12',
    encryption_key: 'Sixteen chars!!!',
    time_skew: 20,
  });
  const env = receiverEnv(config, 'tok', 'info');
  assert.deepEqual(Object.keys(env).sort(), [
    'CHANNEL_PROTOCOL',
    'CHANNEL_TOKEN',
    'LOG_LEVEL',
    'SIA_ACCOUNTS',
    'SIA_TIME_SKEW',
  ]);
  const accounts = parseAccountsEnv(env.SIA_ACCOUNTS);
  assert.deepEqual([...accounts.keys()], ['1234', 'AB12']);
  assert.equal(accounts.get('1234').key.toString('latin1'), 'Sixteen chars!!!');
  assert.equal(env.SIA_TIME_SKEW, '20');
  assert.equal(env.CHANNEL_PROTOCOL, '2', 'protocol 2: a receiver on the old image is recreated');
  assert.equal(receiverEnv(normalizeConfig({ accounts: '1234' }), 'tok').LOG_LEVEL, undefined);
  assert.equal(
    JSON.parse(receiverEnv(normalizeConfig({ accounts: '1234' }), 'tok').SIA_ACCOUNTS)[0].key,
    '',
  );
});

test('the receiver reads a broken SIA_ACCOUNTS as no account', () => {
  assert.equal(parseAccountsEnv('not json').size, 0);
  assert.equal(parseAccountsEnv('{"a":1}').size, 0);
  assert.equal(parseAccountsEnv(undefined).size, 0);
});
