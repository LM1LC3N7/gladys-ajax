// -----------------------------------------------------------------------------
// Account state -> Gladys device and states (pure).
//
// One device per SIA account (one Ajax hub): `ext:<selector>:hub:<account>`.
// SIA is one-way reporting: every feature is read-only.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
} from '@gladysassistant/integration-sdk';
import { MODES } from './constants.js';
import { ALL, DEVICE_NAME, FEATURE_NAMES, MODE_NAMES, NONE, eventText, word } from './i18n.js';
import { hasFault, modeOf } from './model.js';

const binary = (category, type) => ({ category, type, min: 0, max: 1, keep_history: true });
const text = (type) => ({ category: C.TEXT, type, min: 0, max: 0, keep_history: false });

/** The features, by key (the last part of their external id). Keys are forever. */
export const FEATURES = {
  mode: text(T.TEXT.SELECT),
  alarm: binary(C.SIREN, T.SIREN.BINARY),
  tamper: binary(C.TAMPER, T.TAMPER.BINARY),
  'battery-low': binary(C.BATTERY_LOW, T.BATTERY_LOW.BINARY),
  'mains-power': binary(C.INPUT, T.INPUT.BINARY),
  'device-link': binary(C.INPUT, T.INPUT.BINARY),
  online: binary(C.INPUT, T.INPUT.BINARY),
  'armed-groups': text(T.TEXT.TEXT),
  'last-event': text(T.TEXT.TEXT),
};

export const deviceIds = (gladys, account) => gladys.externalIds('hub', account);

/** `ext:sel:hub:1234:mode` -> { account: '1234', key: 'mode' }; the device id -> { account }. */
export function parseExternalId(externalId) {
  const match = /:hub:([0-9A-F]{3,16})(?::([a-z-]+))?$/.exec(String(externalId ?? ''));
  return match ? { account: match[1], key: match[2] } : undefined;
}

export function buildDevice(gladys, account, language) {
  const ids = deviceIds(gladys, account);
  return {
    name: DEVICE_NAME[language]?.(account) ?? DEVICE_NAME.en(account),
    external_id: ids.device,
    should_poll: false,
    params: [{ name: 'account', value: account }],
    features: Object.entries(FEATURES).map(([key, definition]) => ({
      name: word(FEATURE_NAMES[key], language),
      external_id: ids.feature(key),
      read_only: true,
      has_feedback: false,
      ...definition,
      ...(key === 'mode'
        ? {
            supported_options: MODES.map((value) => ({
              value,
              label: word(MODE_NAMES[value], language),
            })),
          }
        : {}),
    })),
  };
}

/**
 * Every state of one account: `[{ device_feature_external_id, state | text }]`.
 * @param {{ online: boolean, language: string }} options
 */
export function accountStates(gladys, account, state, { online, language }) {
  const ids = deviceIds(gladys, account);
  const value = (key, v) => ({
    device_feature_external_id: ids.feature(key),
    ...(typeof v === 'string' ? { text: v } : { state: v }),
  });
  const states = [
    value('mode', modeOf(state)),
    value('alarm', Object.keys(state.alarms).length > 0 ? 1 : 0),
    value('tamper', hasFault(state, 'tamper') ? 1 : 0),
    value('battery-low', hasFault(state, 'battery') ? 1 : 0),
    value('mains-power', hasFault(state, 'power') ? 0 : 1),
    value('device-link', hasFault(state, 'link') ? 0 : 1),
    value('online', online ? 1 : 0),
    value(
      'armed-groups',
      state.armed
        ? word(ALL, language)
        : state.groups.length > 0
          ? state.groups.join(', ')
          : word(NONE, language),
    ),
  ];
  if (state.lastEvent) {
    states.push(value('last-event', eventText(state.lastEvent, language)));
  }
  return states;
}
