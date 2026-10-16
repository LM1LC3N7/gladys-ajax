// -----------------------------------------------------------------------------
// Fixed values: manifest keys, the receiver sub-container, value lists,
// limits and timings. The SDK exports the Gladys categories, types and units,
// not the values: the ones used here mirror server/utils/constants.js of the
// core (binary 1 = on).
// -----------------------------------------------------------------------------

/** The sub-container of the manifest `containers` and its ports. */
export const RECEIVER = {
  name: 'sia-receiver',
  siaPort: 7777,
  channelPort: 7778,
  tcpPortName: 'sia',
  udpPortName: 'sia_udp',
};

/** Manifest keys: frozen, users store them in scenes. */
export const ACTIONS = {
  STATUS: 'status',
  CLEAR: 'clear',
};

export const SCENE_TRIGGERS = {
  ALARM: 'alarm',
  MODE_CHANGED: 'mode_changed',
  FAULT: 'fault',
  RESTORE: 'restore',
  EVENT: 'sia_event',
};

/** Values of the mode select (frozen): partial = some Ajax groups armed. */
export const MODES = ['disarmed', 'armed', 'night', 'partial'];

/** Kinds of alarm, as the scene trigger filters them (frozen). */
export const ALARM_KINDS = [
  'intrusion',
  'fire',
  'heat',
  'gas',
  'water',
  'panic',
  'medical',
  'duress',
  'code_tamper',
  'freeze',
];

/** Kinds of fault (frozen); `offline` is the supervision, `other` a fault the hub reports without a restore. */
export const FAULT_KINDS = ['tamper', 'battery', 'power', 'link', 'offline', 'other'];

export const KEY_FORMATS = ['auto', 'ascii', 'hex'];

/** Allowed clock difference, seconds (0 = not checked). */
export const TIME_SKEW = { default: 60, min: 0, max: 3600 };
/** The hub's periodic test interval, minutes (0 = no supervision). */
export const PING_INTERVAL = { default: 1, min: 0, max: 1440 };

export const TIMINGS = {
  /** Supervision check. */
  tick: 15_000,
  /** A hub is offline after two missed periodic tests plus this. */
  offlineGrace: 30_000,
  /** Messages the receiver kept while this container was away: no scene event past this age. */
  staleEvent: 5 * 60_000,
  /** Every state is published again this often (keeps the values recently dated). */
  stateHeartbeat: 30 * 60_000,
  /** Saving the state to /data waits this long for more changes. */
  persistDelay: 1_000,
};

export const LIMITS = {
  /** Gladys accepts 300 scene events per minute per integration: keep a margin. */
  sceneEventsPerMinute: 240,
};
