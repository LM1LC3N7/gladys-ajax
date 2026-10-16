import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { FEATURES, accountStates, buildDevice, parseExternalId } from '../src/devices.js';
import { codeLabel, eventText } from '../src/i18n.js';
import { applyEvent, emptyState } from '../src/model.js';

const gladys = createFakeGladys();

test('the device passes the Gladys checks, every feature read-only', async () => {
  const device = buildDevice(gladys, 'AB12', 'en');
  await gladys.publishDiscoveredDevices([device]);
  assert.equal(device.external_id, 'ext:test-integration:hub:AB12');
  assert.equal(device.name, 'Ajax alarm AB12');
  assert.deepEqual(
    device.features.map((feature) => feature.external_id.split(':').pop()),
    Object.keys(FEATURES),
  );
  const mode = device.features[0];
  assert.deepEqual(
    mode.supported_options.map((option) => option.value),
    ['disarmed', 'armed', 'night', 'partial'],
  );
  assert.equal(mode.supported_options[2].label, 'Night mode');
  assert.ok(device.features.every((feature) => feature.read_only === true));
  assert.deepEqual(device.params, [{ name: 'account', value: 'AB12' }]);
});

test('states of a state, accepted by the fake Gladys', async () => {
  let state = emptyState();
  for (const event of [
    { code: 'CG', number: 2, group: 2 },
    { code: 'AT', number: 0 },
    { code: 'XL', number: 5 },
  ]) {
    state = applyEvent(state, event, { at: new Date() }).state;
  }
  const states = accountStates(gladys, 'AB12', state, { online: true, language: 'fr' });
  await gladys.publishStates(states);
  const value = (key) => states.find((s) => s.device_feature_external_id.endsWith(`:${key}`));
  assert.equal(value('mode').text, 'partial');
  assert.equal(value('armed-groups').text, '2');
  assert.equal(value('mains-power').state, 0);
  assert.equal(value('device-link').state, 0);
  assert.equal(value('tamper').state, 0);
  assert.equal(value('online').state, 1);
  assert.equal(value('last-event').text, 'Liaison perdue, appareil 5 (XL)');
  const empty = accountStates(gladys, 'AB12', emptyState(), { online: false, language: 'en' });
  assert.equal(empty.length, 8, 'no last event yet');
  assert.equal(
    empty.find((s) => s.device_feature_external_id.endsWith(':armed-groups')).text,
    'none',
  );
});

test('parseExternalId', () => {
  assert.deepEqual(parseExternalId('ext:sel:hub:AB12:mode'), { account: 'AB12', key: 'mode' });
  assert.deepEqual(parseExternalId('ext:sel:hub:AB12'), { account: 'AB12', key: undefined });
  assert.equal(parseExternalId('ext:sel:other:1'), undefined);
});

test('event texts: Ajax labels, SIA types for the rest', () => {
  assert.equal(codeLabel('BA', 'fr'), 'Intrusion');
  assert.equal(codeLabel('QA', 'fr'), 'Emergency Alarm');
  assert.equal(codeLabel('ZX', 'en'), 'ZX');
  assert.equal(
    eventText({ code: 'BA', zone: 0, user: null, group: null, text: 'Hall' }, 'en'),
    'Intrusion, hub, Hall (BA)',
  );
  assert.equal(
    eventText({ code: 'OP', zone: null, user: 3, group: null }, 'fr'),
    'Désarmée, utilisateur 3 (OP)',
  );
});
