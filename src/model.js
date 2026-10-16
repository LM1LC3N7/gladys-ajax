// -----------------------------------------------------------------------------
// One Ajax hub (one SIA account) as its events describe it, pure.
//
// SIA only reports what happens: the state is learned from the events (and
// saved in /data so a restart keeps it). The codes and what the number after
// them means follow the Ajax "OS Malevich" SIA table (shipped with
// pysiaalarm) and homebridge-ajax-sia, which runs on a real Hub 2:
//
// - arming: CL/CA/CF/... armed (number = user), NL/NF... night mode on,
//   NP/NO/ND night mode off, OP/OA/... disarmed; with Ajax groups ("group
//   mode") CG/CB arm and OG/OB disarm the group given by `ri`;
// - alarms: BA intrusion, FA fire, KA heat, GA gas (CO), WA water, PA panic,
//   MA medical, HA duress (Ajax sends it for a disarm with the duress code),
//   JA code guessing, ZA freeze; number = zone (the Ajax device number,
//   0 = the hub). Fire, heat, gas, water and freeze end with their restore
//   code (FH, KH, GH, WH…). Intrusion and code guessing raised while armed
//   stay until a disarm (a door closed again does not end the alarm); the
//   others also end with their restore code;
// - faults: TA/TR tamper, XT/XR YT/YR YM/YA battery, AT/AR YP/YQ power,
//   XL/XC PF/PO XQ/XH YC/YK connection, per zone;
// - RP / NULL are link tests: they only feed the supervision.
//
// The rules extend the ones of homebridge-ajax-sia (MIT, see
// THIRD_PARTY_NOTICES.md).
// -----------------------------------------------------------------------------

const FULL_ARM = new Set(['CL', 'CA', 'CP', 'CF', 'CQ', 'CS', 'CK', 'CJ', 'AF']);
const GROUP_ARM = new Set(['CG', 'CB']);
/** CF and AF are also sent for one group armed with faults: a group then, when groups are used. */
const ARM_EITHER = new Set(['CF', 'AF']);
const FULL_DISARM = new Set(['OP', 'OA', 'OQ', 'OR', 'OS', 'OK', 'OJ', 'OH', 'OL']);
const GROUP_DISARM = new Set(['OG', 'OB']);
const NIGHT_ON = new Set(['NL', 'NF', 'NC', 'NB', 'NM']);
const NIGHT_OFF = new Set(['NP', 'NO', 'ND']);

export const ALARM_CODES = {
  BA: 'intrusion',
  BV: 'intrusion',
  UA: 'intrusion',
  FA: 'fire',
  KA: 'heat',
  GA: 'gas',
  WA: 'water',
  PA: 'panic',
  MA: 'medical',
  HA: 'duress',
  JA: 'code_tamper',
  ZA: 'freeze',
};
const ALARM_RESTORES = {
  BR: 'intrusion',
  BH: 'intrusion',
  FR: 'fire',
  FH: 'fire',
  KR: 'heat',
  KH: 'heat',
  GR: 'gas',
  GH: 'gas',
  WR: 'water',
  WH: 'water',
  PR: 'panic',
  PH: 'panic',
  MR: 'medical',
  MH: 'medical',
  HR: 'duress',
  HH: 'duress',
  JC: 'code_tamper',
  ZR: 'freeze',
  ZH: 'freeze',
};
/** Alarms a disarm does not end: the condition is still there until the detector says otherwise. */
const PERSISTENT = new Set(['fire', 'heat', 'gas', 'water', 'freeze']);
/** Alarms that, raised while armed, wait for a disarm even after their restore code. */
const LATCHING = new Set(['intrusion', 'code_tamper']);

export const FAULT_CODES = {
  TA: 'tamper',
  XT: 'battery',
  YT: 'battery',
  YM: 'battery',
  AT: 'power',
  YP: 'power',
  XL: 'link',
  PF: 'link',
  XQ: 'link',
  YC: 'link',
};
/** Restore code -> the fault code it ends. */
const FAULT_RESTORES = {
  TR: 'TA',
  XR: 'XT',
  YR: 'YT',
  YA: 'YM',
  AR: 'AT',
  YQ: 'YP',
  XC: 'XL',
  PO: 'PF',
  XH: 'XQ',
  YK: 'YC',
};
/** Faults reported once, with no restore code: an event, no state. */
const OTHER_FAULTS = new Set([
  'FT',
  'FS',
  'BS',
  'SM',
  'YS',
  'YX',
  'YF',
  'ET',
  'EM',
  'LT',
  'NT',
  'XS',
  'YU',
  'YI',
]);
export const LINK_TESTS = new Set(['RP', 'RX']);

const ARMING_CODES = new Set([
  ...FULL_ARM,
  ...GROUP_ARM,
  ...FULL_DISARM,
  ...GROUP_DISARM,
  ...NIGHT_ON,
  ...NIGHT_OFF,
  'CC',
  'CD',
  'CI',
  'NE',
  'HA',
]);

export const emptyState = () => ({
  armed: false,
  night: false,
  groups: [],
  knownGroups: [],
  groupMode: false,
  alarms: {},
  faults: {},
  lastEvent: null,
  lastSeen: null,
  offline: false,
});

/** A saved state (any version) -> a complete one. */
export function restoreState(saved) {
  const state = { ...emptyState(), ...(saved && typeof saved === 'object' ? saved : {}) };
  for (const key of ['groups', 'knownGroups']) {
    state[key] = Array.isArray(state[key]) ? state[key].filter(Number.isInteger) : [];
  }
  for (const key of ['alarms', 'faults']) {
    state[key] = state[key] && typeof state[key] === 'object' ? state[key] : {};
  }
  return state;
}

export function modeOf(state) {
  if (state.armed) return 'armed';
  if (state.night) return 'night';
  if (state.groups.length > 0) return 'partial';
  return 'disarmed';
}

/** Whether the number after the code is a user (arming) rather than a zone. */
export const numberIsUser = (code) => ARMING_CODES.has(code);

/** The parts of an event, as scene events and texts use them. */
export function describe(event) {
  const isUser = numberIsUser(event.code);
  return {
    code: event.code,
    zone: isUser ? null : (event.number ?? 0),
    user: isUser ? (event.number ?? event.user ?? null) : (event.user ?? null),
    group: event.group > 0 ? event.group : null,
    text: event.text ?? null,
  };
}

const sorted = (numbers) => [...new Set(numbers)].sort((a, b) => a - b);

/**
 * @param {object} state the account state (not modified)
 * @param {object} event { code, number?, group?, user?, text? }
 * @param {{ at: Date }} options
 * @returns {{ state: object, effects: object[] }} effects: `mode`, `alarm`, `fault`, `restore`, `event`
 */
export function applyEvent(state, event, { at }) {
  const next = structuredClone(restoreState(state));
  const effects = [];
  const when = at.toISOString();
  const { code } = event;
  const parts = describe(event);
  const group = parts.group ?? 0;
  const zone = parts.zone ?? 0;
  const before = modeOf(next);

  if (group > 0 && ARMING_CODES.has(code)) {
    next.knownGroups = sorted([...next.knownGroups, group]);
  }

  const clearAlarms = (predicate, reason) => {
    for (const [key, alarm] of Object.entries(next.alarms)) {
      if (!PERSISTENT.has(alarm.kind) && predicate(alarm)) {
        delete next.alarms[key];
        effects.push({ type: 'restore', kind: alarm.kind, zone: alarm.zone, reason, event });
      }
    }
  };
  const disarmAll = () => {
    next.armed = false;
    next.night = false;
    next.groups = [];
    clearAlarms(() => true, 'disarm');
  };
  const disarmGroup = (number) => {
    if (next.armed) {
      next.armed = false;
      next.groups = next.knownGroups.filter((known) => known !== number);
    } else {
      next.groups = next.groups.filter((armed) => armed !== number);
    }
    clearAlarms((alarm) => alarm.group === number || alarm.group === null, 'disarm');
  };
  const armGroup = (number) => {
    next.groups = sorted([...next.groups, number]);
  };

  if (GROUP_ARM.has(code) || GROUP_DISARM.has(code)) {
    next.groupMode = true;
  }
  if (FULL_ARM.has(code) && !(ARM_EITHER.has(code) && group > 0 && next.groupMode)) {
    next.armed = true;
    next.night = false;
    next.groups = [];
  } else if (FULL_ARM.has(code) || GROUP_ARM.has(code)) {
    if (group > 0) {
      armGroup(group);
    } else {
      next.armed = true;
      next.night = false;
    }
  } else if (FULL_DISARM.has(code)) {
    disarmAll();
  } else if (GROUP_DISARM.has(code)) {
    if (group > 0) disarmGroup(group);
    else disarmAll();
  } else if (NIGHT_ON.has(code)) {
    next.night = true;
    next.armed = false;
  } else if (NIGHT_OFF.has(code)) {
    next.night = false;
  } else if (code === 'HA') {
    // Ajax: disarmed with the duress code. The disarm first, then the silent alarm.
    if (group > 0 && next.groupMode) disarmGroup(group);
    else disarmAll();
  }

  const after = modeOf(next);
  if (after !== before) {
    effects.push({ type: 'mode', mode: after, previous: before, event });
  }

  const alarmKind = ALARM_CODES[code] ?? (code === 'ND' ? 'duress' : undefined);
  if (alarmKind) {
    const key = `${alarmKind}:${zone}`;
    const isNew = !next.alarms[key];
    next.alarms[key] = {
      kind: alarmKind,
      code,
      zone,
      group: parts.group,
      latched: LATCHING.has(alarmKind) && before !== 'disarmed',
      at: isNew ? when : next.alarms[key].at,
    };
    if (isNew) effects.push({ type: 'alarm', kind: alarmKind, zone, event });
  } else if (ALARM_RESTORES[code]) {
    const kind = ALARM_RESTORES[code];
    const ended = (alarm) =>
      alarm.kind === kind && (alarm.zone === zone || (zone === 0 && !next.alarms[`${kind}:0`]));
    for (const [key, alarm] of Object.entries(next.alarms)) {
      if (ended(alarm) && !(alarm.latched && modeOf(next) !== 'disarmed')) {
        delete next.alarms[key];
        effects.push({ type: 'restore', kind, zone: alarm.zone, reason: 'restore', event });
      }
    }
  } else if (FAULT_CODES[code]) {
    const key = `${code}:${zone}`;
    if (!next.faults[key]) {
      next.faults[key] = { kind: FAULT_CODES[code], code, zone, at: when };
      effects.push({ type: 'fault', kind: FAULT_CODES[code], zone, event });
    }
  } else if (FAULT_RESTORES[code]) {
    const raised = FAULT_RESTORES[code];
    // The fault of that zone; a restore without a zone ends them all when the hub had none.
    const exact = Boolean(next.faults[`${raised}:${zone}`]);
    for (const [key, fault] of Object.entries(next.faults)) {
      if (fault.code === raised && (fault.zone === zone || (zone === 0 && !exact))) {
        delete next.faults[key];
        effects.push({
          type: 'restore',
          kind: fault.kind,
          zone: fault.zone,
          reason: 'restore',
          event,
        });
      }
    }
  } else if (OTHER_FAULTS.has(code)) {
    effects.push({ type: 'fault', kind: 'other', zone, event });
  }

  if (!LINK_TESTS.has(code)) {
    next.lastEvent = { ...parts, at: when };
    effects.push({ type: 'event', event });
  }
  return { state: next, effects };
}

/** The alarm and fault memory emptied (the "Clear" button): no effect, the user asked. */
export function clearMemory(state) {
  return { ...restoreState(state), alarms: {}, faults: {} };
}

export const hasFault = (state, kind) =>
  Object.values(state.faults).some((fault) => fault.kind === kind);
