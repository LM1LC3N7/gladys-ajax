// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { AjaxApp } from '../src/app.js';
import { DEFAULTS, LANGUAGES } from '../src/config.js';
import {
  ACTIONS,
  ALARM_KINDS,
  FAULT_KINDS,
  KEY_FORMATS,
  MODES,
  PING_INTERVAL,
  RECEIVER,
  SCENE_TRIGGERS,
  TIME_SKEW,
} from '../src/constants.js';
import { SIA_PORT } from '../src/sia/service.js';
import { CHANNEL_PORT } from '../src/channel.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const handlers = read('src/handlers.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) {
      yield* texts(entry, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  assert.equal(manifest.gladys_version, '>=5.1.0', 'scene triggers need Gladys 5.1');
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-ajax:${manifest.version}`);
  assert.equal(manifest.version, JSON.parse(read('package.json')).version);
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['security']);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    const docs = read(`docs/${lang}.md`);
    assert.ok(docs.length >= 300, `docs/${lang}.md is too short for the store`);
    assert.match(docs, /not\s+affiliated\s+with\s+Ajax|sans\s+lien\s+avec\s+Ajax/i);
  }
});

test('every text is in English and French', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) {
      assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
    }
  }
});

test('the receiver sub-container: same image, its command, its ports', () => {
  assert.equal(manifest.containers.length, 1);
  const [receiver] = manifest.containers;
  assert.equal(receiver.name, RECEIVER.name);
  assert.equal(receiver.docker_image, manifest.docker_image, 'released with the main image');
  assert.deepEqual(receiver.command, ['node', 'src/receiver.js']);
  assert.equal(receiver.start, 'manual', 'started by the app, with its env');
  assert.equal(receiver.read_only, true);
  assert.ok(receiver.memory_mb >= 32 && receiver.memory_mb <= 256);
  assert.equal(receiver.env, undefined, 'the manifest is public: no secret here');
  assert.deepEqual(
    receiver.ports.map((port) => [port.container_port, port.protocol, port.name, port.browsable]),
    [
      [SIA_PORT, 'tcp', RECEIVER.tcpPortName, false],
      [SIA_PORT, 'udp', RECEIVER.udpPortName, false],
    ],
  );
  assert.equal(RECEIVER.siaPort, SIA_PORT);
  assert.equal(RECEIVER.channelPort, CHANNEL_PORT);
  assert.ok(
    !receiver.ports.some((port) => port.container_port === CHANNEL_PORT),
    'never published',
  );
  // Every {{port:<name>}} refers to a declared port (the store refuses the manifest otherwise).
  const names = receiver.ports.map((port) => port.name);
  for (const [, text] of texts(manifest.config_schema)) {
    for (const lang of ['en', 'fr']) {
      for (const [, name] of (text[lang] ?? '').matchAll(/\{\{port:([^}]+)\}\}/g)) {
        assert.ok(names.includes(name), `{{port:${name}}}`);
      }
    }
  }
  const setup = manifest.config_schema.find((field) => field.key === 'hub_setup');
  for (const lang of ['en', 'fr']) {
    assert.match(setup.description[lang], /\{\{gladys_host\}\}/);
    assert.match(setup.description[lang], /\{\{port:sia\}\}/);
  }
});

test('the configuration matches the code', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.ok(fields[key], `${key} is not in the config_schema`);
    assert.deepEqual(fields[key].default, value, key);
  }
  assert.deepEqual(
    fields.language.options.map((o) => o.value),
    LANGUAGES,
  );
  assert.deepEqual(
    fields.key_format.options.map((o) => o.value),
    KEY_FORMATS,
  );
  assert.equal(fields.accounts.type, 'string');
  assert.equal(fields.accounts.required, true);
  assert.equal(fields.encryption_key.type, 'secret', 'the key is never sent back to the browser');
  assert.deepEqual([fields.time_skew.min, fields.time_skew.max], [TIME_SKEW.min, TIME_SKEW.max]);
  assert.deepEqual(
    [fields.ping_interval.min, fields.ping_interval.max],
    [PING_INTERVAL.min, PING_INTERVAL.max],
  );
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(
      section.required ?? section.default ?? section.placeholder,
      undefined,
      section.key,
    );
    for (const lang of ['en', 'fr']) {
      assert.ok(
        section.description[lang].length <= 1000,
        `${section.key}.${lang}: ${section.description[lang].length} characters`,
      );
    }
    assert.ok((section.links ?? []).every((l) => l.url.startsWith('https://')));
  }
});

test('the actions are the ones the code handles', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), `ACTIONS.${name} has no handler`);
  }
  assert.equal(manifest.scene_actions, undefined, 'SIA is one-way: nothing to command');
});

test('the scene triggers: keys, filter options, and exactly the data the app sends', async () => {
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
  const trigger = (key) => manifest.scene_triggers.find((t) => t.key === key);
  const options = (key, field) =>
    trigger(key)
      .fields.find((f) => f.key === field)
      .options.map((o) => o.value);
  assert.deepEqual(options('alarm', 'kind'), ALARM_KINDS);
  assert.deepEqual(options('fault', 'kind'), FAULT_KINDS);
  assert.deepEqual(options('mode_changed', 'mode'), MODES);
  assert.deepEqual(options('restore', 'kind'), [
    ...ALARM_KINDS,
    ...FAULT_KINDS.filter((kind) => kind !== 'other'),
  ]);
  for (const item of manifest.scene_triggers) {
    const device = item.fields.find((f) => f.key === 'device');
    assert.equal(device?.source, 'devices', `${item.key}: filter by hub`);
  }

  // Run one effect of each type through the app and compare the data keys.
  const gladys = createFakeGladys({ config: { accounts: '1234' } });
  const app = new AjaxApp({ gladys, store: { load: async () => ({}), save: async () => {} } });
  app.config = (await import('../src/config.js')).normalizeConfig({ accounts: '1234' });
  await app.load();
  const event = { code: 'BA', number: 3, group: 1 };
  await app.fireEffects('1234', [
    { type: 'mode', mode: 'armed', previous: 'disarmed', event: { code: 'CL', number: 1 } },
    { type: 'alarm', kind: 'intrusion', zone: 3, event },
    { type: 'fault', kind: 'offline', zone: 0 },
    { type: 'restore', kind: 'intrusion', zone: 3, event },
    { type: 'event', event },
  ]);
  for (const { key, data } of gladys.fake.sceneEvents) {
    const declared = [...trigger(key).fields, ...trigger(key).variables].map((f) => f.key);
    assert.deepEqual(Object.keys(data).sort(), [...new Set(declared)].sort(), key);
    for (const variable of trigger(key).variables) {
      const value = data[variable.key];
      if (value !== null) {
        assert.equal(typeof value, variable.type, `${key}.${variable.key}`);
      }
    }
  }
  assert.equal(gladys.fake.sceneEvents.length, 5);
});
