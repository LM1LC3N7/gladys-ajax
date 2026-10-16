import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyEvent,
  clearMemory,
  describe,
  emptyState,
  hasFault,
  modeOf,
  restoreState,
} from '../src/model.js';

const at = new Date('2026-10-16T10:00:00Z');

/** Applies `CODE[number][@group]` tokens in turn: returns the state and every effect. */
function run(tokens, state = emptyState()) {
  const effects = [];
  for (const token of tokens.split(' ')) {
    const [, code, number, group] = /^([A-Z]{2})(\d*)(?:@(\d+))?$/.exec(token);
    const event = { code };
    if (number !== '') event.number = Number(number);
    if (group !== undefined) event.group = Number(group);
    const result = applyEvent(state, event, { at });
    state = result.state;
    effects.push(...result.effects);
  }
  return { state, effects, types: effects.map((effect) => effect.type) };
}

test('arming, night mode and disarming (number = user)', () => {
  let { state, effects } = run('CL5@1');
  assert.equal(modeOf(state), 'armed');
  assert.deepEqual(effects[0], {
    type: 'mode',
    mode: 'armed',
    previous: 'disarmed',
    event: { code: 'CL', number: 5, group: 1 },
  });
  assert.deepEqual(describe({ code: 'CL', number: 5, group: 1 }), {
    code: 'CL',
    zone: null,
    user: 5,
    group: 1,
    text: null,
  });
  ({ state } = run('OP5', state));
  assert.equal(modeOf(state), 'disarmed');
  ({ state } = run('NL2'));
  assert.equal(modeOf(state), 'night');
  ({ state } = run('NP2', state));
  assert.equal(modeOf(state), 'disarmed');
  for (const code of ['CA', 'CP', 'CF', 'CQ', 'CS', 'AF']) {
    assert.equal(modeOf(run(code).state), 'armed', code);
  }
  for (const code of ['NF', 'NC', 'NB']) {
    assert.equal(modeOf(run(code).state), 'night', code);
  }
  for (const code of ['OA', 'OQ', 'OR', 'OS']) {
    assert.equal(modeOf(run(`CL1 ${code}`).state), 'disarmed', code);
  }
  assert.equal(modeOf(run('NL1 NO').state), 'disarmed');
});

test('a repeated arming is not a change', () => {
  const { types } = run('CL1 CL1');
  assert.deepEqual(types, ['mode', 'event', 'event']);
});

test('Ajax groups: CG / OG per group, partial mode, a full arm over them', () => {
  let { state, effects } = run('CG3@1');
  assert.equal(modeOf(state), 'partial');
  assert.equal(state.groupMode, true);
  assert.deepEqual(state.groups, [1]);
  assert.equal(effects[0].mode, 'partial');
  ({ state } = run('CG3@2', state));
  assert.deepEqual(state.groups, [1, 2]);
  ({ state } = run('OG3@1', state));
  assert.deepEqual(state.groups, [2]);
  // CF with a group, once groups are in use, arms that group only.
  ({ state } = run('CF3@3', state));
  assert.deepEqual(state.groups, [2, 3]);
  ({ state } = run('CL3', state));
  assert.equal(modeOf(state), 'armed');
  // Disarming one group of a fully armed system leaves the other known groups armed.
  ({ state } = run('OG3@2', state));
  assert.equal(modeOf(state), 'partial');
  assert.deepEqual(state.groups, [1, 3]);
  ({ state } = run('OP3', state));
  assert.equal(modeOf(state), 'disarmed');
  assert.deepEqual(state.groups, []);
  // Automatic group arming / disarming (Ajax CB / OB).
  ({ state } = run('CB@4 OB@4'));
  assert.equal(modeOf(state), 'disarmed');
});

test('an intrusion while armed stays until a disarm, even after the door closes', () => {
  let { state, effects } = run('CL1 BA3@1');
  assert.deepEqual(
    effects.filter((effect) => effect.type === 'alarm').map((effect) => [effect.kind, effect.zone]),
    [['intrusion', 3]],
  );
  ({ state, effects } = run('BR3', state));
  assert.equal(Object.keys(state.alarms).length, 1, 'still in alarm');
  assert.ok(!effects.some((effect) => effect.type === 'restore'));
  // A second detection of the same zone is not a new alarm.
  ({ effects } = run('BA3', state));
  assert.ok(!effects.some((effect) => effect.type === 'alarm'));
  ({ state, effects } = run('OP1', state));
  assert.deepEqual(state.alarms, {});
  assert.deepEqual(
    effects
      .filter((effect) => effect.type === 'restore')
      .map((effect) => [effect.kind, effect.reason]),
    [['intrusion', 'disarm']],
  );
});

test('an always-active detector while disarmed ends with its restore code', () => {
  const { state, types } = run('BA7 BR7');
  assert.deepEqual(state.alarms, {});
  assert.deepEqual(types, ['alarm', 'event', 'restore', 'event']);
});

test('fire, gas and water outlast a disarm, and end with their restore code', () => {
  let { state } = run('CL1 FA4 GA5 WA6 OP1');
  assert.deepEqual(
    Object.values(state.alarms).map((alarm) => alarm.kind),
    ['fire', 'gas', 'water'],
  );
  ({ state } = run('FH4 GH5 WH6', state));
  assert.deepEqual(state.alarms, {});
  ({ state } = run('KA2 KH2'));
  assert.deepEqual(state.alarms, {});
});

test('panic: raised and cancelled (Ajax PH), or ended by a disarm', () => {
  assert.deepEqual(run('PA1 PH1').state.alarms, {});
  assert.deepEqual(run('CL1 PA1 OP1').state.alarms, {});
  assert.deepEqual(run('MA2 MR2').state.alarms, {});
});

test('Ajax duress: HA disarms and raises a duress alarm, ND turns night mode off', () => {
  let { state, effects } = run('CL1 HA2');
  assert.equal(modeOf(state), 'disarmed');
  assert.deepEqual(
    effects.slice(2).map((effect) => [effect.type, effect.kind ?? effect.mode]),
    [
      ['mode', 'disarmed'],
      ['alarm', 'duress'],
      ['event', undefined],
    ],
  );
  assert.equal(describe({ code: 'HA', number: 2 }).user, 2);
  ({ state } = run('NL1 ND1'));
  assert.equal(modeOf(state), 'disarmed');
  assert.equal(Object.values(state.alarms)[0].kind, 'duress');
});

test('a restore without a zone ends every alarm of its kind', () => {
  const { state } = run('WA3 WA4 WH');
  assert.deepEqual(state.alarms, {});
});

test('faults per zone, with their restore codes', () => {
  let { state, effects } = run('TA0 XT5 AT YM XL7 XQ PF8 YC');
  for (const kind of ['tamper', 'battery', 'power', 'link']) {
    assert.ok(hasFault(state, kind), kind);
  }
  assert.equal(effects.filter((effect) => effect.type === 'fault').length, 8);
  ({ state, effects } = run('TR0 XR5 AR YA XC7 XH PO8 YK', state));
  assert.deepEqual(state.faults, {});
  assert.equal(effects.filter((effect) => effect.type === 'restore').length, 8);
  // The same fault twice is one fault; another zone is another one.
  ({ state, effects } = run('XT5 XT5 XT6'));
  assert.equal(Object.keys(state.faults).length, 2);
  assert.equal(effects.filter((effect) => effect.type === 'fault').length, 2);
  // The hub's battery restore (zone 0) does not end a detector's.
  ({ state } = run('YT0 YT9 YR0'));
  assert.deepEqual(Object.keys(state.faults), ['YT:9']);
});

test('one-off faults and link tests', () => {
  const { state, effects } = run('SM4 FT2 RP0');
  assert.deepEqual(
    effects.map((effect) => [effect.type, effect.kind]),
    [
      ['fault', 'other'],
      ['event', undefined],
      ['fault', 'other'],
      ['event', undefined],
    ],
  );
  assert.deepEqual(state.faults, {});
  assert.equal(state.lastEvent.code, 'FT', 'a link test does not replace the last event');
});

test('the last event keeps its parts', () => {
  const { state } = run('BA12@2');
  assert.deepEqual(state.lastEvent, {
    code: 'BA',
    zone: 12,
    user: null,
    group: 2,
    text: null,
    at: '2026-10-16T10:00:00.000Z',
  });
});

test('clearMemory empties alarms and faults, not the mode', () => {
  const { state } = run('CL1 BA3 TA2');
  const cleared = clearMemory(state);
  assert.deepEqual(cleared.alarms, {});
  assert.deepEqual(cleared.faults, {});
  assert.equal(modeOf(cleared), 'armed');
});

test('restoreState repairs a saved state', () => {
  assert.deepEqual(restoreState(null), emptyState());
  const repaired = restoreState({ armed: true, groups: [1, 'x'], alarms: null });
  assert.equal(repaired.armed, true);
  assert.deepEqual(repaired.groups, [1]);
  assert.deepEqual(repaired.alarms, {});
  assert.deepEqual(repaired.faults, {});
});

test('applyEvent does not modify the state it is given', () => {
  const state = emptyState();
  applyEvent(state, { code: 'CL', number: 1 }, { at });
  assert.deepEqual(state, emptyState());
});
