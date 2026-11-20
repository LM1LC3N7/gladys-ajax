// -----------------------------------------------------------------------------
// Names and texts, French and English. The SIA labels below cover the codes
// Ajax hubs send (their "OS Malevich" table); any other code falls back to
// the English type of the SIA table (src/sia/codes.js).
// -----------------------------------------------------------------------------

import { SIA_CODES } from './sia/codes.js';

export const word = (entry, language) => entry?.[language] ?? entry?.en ?? '';

export const DEVICE_NAME = {
  fr: (account) => `Alarme Ajax ${account}`,
  en: (account) => `Ajax alarm ${account}`,
};

export const FEATURE_NAMES = {
  mode: { fr: 'Mode', en: 'Mode' },
  alarm: { fr: 'Alarme en cours', en: 'Alarm in progress' },
  tamper: { fr: 'Autoprotection', en: 'Tamper' },
  'battery-low': { fr: 'Pile ou batterie faible', en: 'Low battery' },
  'mains-power': { fr: 'Alimentation secteur', en: 'Mains power' },
  'device-link': { fr: 'Liaison des détecteurs', en: 'Devices connected' },
  online: { fr: 'Centrale joignable', en: 'Hub reporting' },
  'armed-groups': { fr: 'Groupes armés', en: 'Armed groups' },
  'last-event': { fr: 'Dernier événement', en: 'Last event' },
};

export const MODE_NAMES = {
  disarmed: { fr: 'Désarmée', en: 'Disarmed' },
  armed: { fr: 'Armée', en: 'Armed' },
  night: { fr: 'Mode nuit', en: 'Night mode' },
  partial: { fr: 'Groupes armés', en: 'Groups armed' },
};

export const NONE = { fr: 'aucun', en: 'none' };
export const ALL = { fr: 'tous', en: 'all' };

export const KIND_NAMES = {
  intrusion: { fr: 'Intrusion', en: 'Intrusion' },
  fire: { fr: 'Incendie', en: 'Fire' },
  heat: { fr: 'Chaleur', en: 'Heat' },
  gas: { fr: 'Gaz (CO)', en: 'Gas (CO)' },
  water: { fr: "Fuite d'eau", en: 'Water leak' },
  panic: { fr: 'Panique', en: 'Panic' },
  medical: { fr: 'Urgence médicale', en: 'Medical' },
  duress: { fr: 'Contrainte', en: 'Duress' },
  code_tamper: { fr: 'Code deviné', en: 'Code guessing' },
  freeze: { fr: 'Gel', en: 'Freeze' },
  tamper: { fr: 'Autoprotection', en: 'Tamper' },
  battery: { fr: 'Batterie', en: 'Battery' },
  power: { fr: 'Alimentation', en: 'Power' },
  link: { fr: 'Liaison', en: 'Connection' },
  offline: { fr: 'Centrale muette', en: 'Hub silent' },
  other: { fr: 'Autre défaut', en: 'Other fault' },
};

/** Short labels of the codes Ajax sends. */
export const CODE_LABELS = {
  CL: { fr: 'Armée', en: 'Armed' },
  CA: { fr: 'Armée automatiquement', en: 'Armed automatically' },
  CP: { fr: 'Armée automatiquement', en: 'Armed automatically' },
  CF: { fr: 'Armée avec défauts', en: 'Armed with faults' },
  AF: { fr: 'Armée automatiquement avec défauts', en: 'Armed automatically with faults' },
  CG: { fr: 'Groupe armé', en: 'Group armed' },
  CB: { fr: 'Groupe armé automatiquement', en: 'Group armed automatically' },
  CC: { fr: "Échec d'armement automatique", en: 'Automatic arming failed' },
  CD: { fr: "Échec d'armement du groupe", en: 'Group arming failed' },
  OP: { fr: 'Désarmée', en: 'Disarmed' },
  OA: { fr: 'Désarmée automatiquement', en: 'Disarmed automatically' },
  OG: { fr: 'Groupe désarmé', en: 'Group disarmed' },
  OB: { fr: 'Groupe désarmé automatiquement', en: 'Group disarmed automatically' },
  NL: { fr: 'Mode nuit activé', en: 'Night mode on' },
  NF: { fr: 'Mode nuit activé avec défauts', en: 'Night mode on with faults' },
  NC: { fr: 'Mode nuit activé automatiquement', en: 'Night mode on automatically' },
  NB: {
    fr: 'Mode nuit activé automatiquement avec défauts',
    en: 'Night mode on automatically with faults',
  },
  NP: { fr: 'Mode nuit désactivé', en: 'Night mode off' },
  NO: { fr: 'Mode nuit désactivé automatiquement', en: 'Night mode off automatically' },
  ND: { fr: 'Mode nuit désactivé sous contrainte', en: 'Night mode off under duress' },
  NE: { fr: "Échec d'activation du mode nuit", en: 'Night mode activation failed' },
  HA: { fr: 'Désarmée sous contrainte', en: 'Disarmed under duress' },
  BA: { fr: 'Intrusion', en: 'Intrusion' },
  BV: { fr: 'Intrusion confirmée', en: 'Verified intrusion' },
  BR: { fr: 'Fin de détection', en: 'Detection over' },
  BH: { fr: "Fin d'alarme intrusion", en: 'Intrusion alarm over' },
  FA: { fr: 'Incendie', en: 'Fire' },
  FH: { fr: "Fin d'alarme incendie", en: 'Fire alarm over' },
  KA: { fr: 'Chaleur excessive', en: 'High temperature' },
  KH: { fr: 'Température normale', en: 'Temperature normal' },
  GA: { fr: 'Gaz (CO) détecté', en: 'Gas (CO) detected' },
  GH: { fr: 'Gaz (CO) normal', en: 'Gas (CO) normal' },
  WA: { fr: "Fuite d'eau", en: 'Water leak' },
  WH: { fr: "Fin de fuite d'eau", en: 'Water leak over' },
  PA: { fr: 'Bouton panique', en: 'Panic button' },
  PH: { fr: 'Alarme panique annulée', en: 'Panic alarm cancelled' },
  MA: { fr: 'Urgence médicale', en: 'Medical alarm' },
  MR: { fr: "Fin d'urgence médicale", en: 'Medical alarm over' },
  JA: { fr: 'Tentative de deviner le code', en: 'Code guessing attempt' },
  TA: { fr: 'Autoprotection ouverte', en: 'Tamper open' },
  TR: { fr: 'Autoprotection fermée', en: 'Tamper closed' },
  XT: { fr: 'Pile faible', en: 'Low battery' },
  XR: { fr: 'Pile chargée', en: 'Battery charged' },
  YT: { fr: 'Batterie de la centrale faible', en: 'Hub battery low' },
  YR: { fr: 'Batterie de la centrale chargée', en: 'Hub battery charged' },
  YM: { fr: 'Batterie de la centrale absente', en: 'Hub battery missing' },
  YA: { fr: 'Batterie de la centrale branchée', en: 'Hub battery connected' },
  AT: { fr: 'Coupure secteur', en: 'Mains power lost' },
  AR: { fr: 'Secteur rétabli', en: 'Mains power back' },
  YP: { fr: "Coupure d'alimentation externe", en: 'External power lost' },
  YQ: { fr: 'Alimentation externe rétablie', en: 'External power back' },
  XL: { fr: 'Liaison perdue', en: 'Connection lost' },
  XC: { fr: 'Liaison rétablie', en: 'Connection back' },
  XQ: { fr: 'Brouillage radio', en: 'Radio interference' },
  XH: { fr: 'Fin de brouillage radio', en: 'Radio interference over' },
  PF: { fr: 'Liaison photo perdue', en: 'Photo channel lost' },
  PO: { fr: 'Liaison photo rétablie', en: 'Photo channel back' },
  YC: { fr: 'Centrale hors ligne', en: 'Hub offline' },
  YK: { fr: 'Centrale en ligne', en: 'Hub online again' },
  YS: { fr: 'Liaison avec la télésurveillance perdue', en: 'Monitoring station connection lost' },
  SM: { fr: 'Détecteur déplacé', en: 'Device moved' },
  FT: { fr: 'Panne du détecteur', en: 'Detector failure' },
  FS: { fr: 'Chambre de fumée sale', en: 'Smoke chamber dirty' },
  FJ: { fr: 'Détecteur rétabli', en: 'Detector restored' },
  ZY: { fr: 'Appareil allumé', en: 'Device switched on' },
  ZZ: { fr: 'Appareil éteint', en: 'Device switched off' },
  RP: { fr: 'Test périodique', en: 'Periodic test' },
};

/** `BA` -> 'Intrusion'; an unknown code -> its SIA type, else the code itself. */
export function codeLabel(code, language) {
  return word(CODE_LABELS[code], language) || SIA_CODES[code]?.[0] || code;
}

const PART_WORDS = {
  zone: { fr: 'appareil', en: 'device' },
  hub: { fr: 'centrale', en: 'hub' },
  user: { fr: 'utilisateur', en: 'user' },
  group: { fr: 'groupe', en: 'group' },
};

/** `{ code: 'BA', zone: 3, group: 1 }` -> 'Intrusion, appareil 3, groupe 1 (BA)'. */
export function eventText(parts, language) {
  const details = [];
  if (parts.zone !== null && parts.zone !== undefined) {
    details.push(
      parts.zone === 0
        ? word(PART_WORDS.hub, language)
        : `${word(PART_WORDS.zone, language)} ${parts.zone}`,
    );
  }
  if (parts.user !== null && parts.user !== undefined) {
    details.push(`${word(PART_WORDS.user, language)} ${parts.user}`);
  }
  if (parts.group !== null && parts.group !== undefined) {
    details.push(`${word(PART_WORDS.group, language)} ${parts.group}`);
  }
  if (parts.text) {
    details.push(parts.text);
  }
  return [codeLabel(parts.code, language), ...details].join(', ') + ` (${parts.code})`;
}

/**
 * The configured account that is `account` with other leading zeros (`12` for `0012`),
 * else undefined. Accounts made of zeros only never match (000 is "no object number").
 */
export function zerosDiffer(account, configured) {
  const trimmed = account.replace(/^0+/, '');
  if (trimmed === '') return undefined;
  return configured.find((other) => other !== account && other.replace(/^0+/, '') === trimmed);
}

/** Messages of the connection status and the buttons. */
export const MESSAGES = {
  noAccount: {
    en: 'Enter the object number of your hub in the configuration.',
    fr: "Saisissez le numéro d'objet de votre centrale dans la configuration.",
  },
  keyError: {
    en: (error) => `The encryption key is not valid: ${error}.`,
    fr: (error) => `La clé de chiffrement n'est pas valide : ${error}.`,
  },
  receiverError: {
    en: (error) => `The SIA receiver could not start: ${error}`,
    fr: (error) => `Le récepteur SIA n'a pas pu démarrer : ${error}`,
  },
  receiverDown: {
    en: 'Waiting for the SIA receiver container.',
    fr: 'En attente du conteneur récepteur SIA.',
  },
  neverSeen: {
    en: (accounts) => `Waiting for the first message of hub ${accounts}.`,
    fr: (accounts) => `En attente du premier message de la centrale ${accounts}.`,
  },
  silent: {
    en: (accounts) => `No message from hub ${accounts} within the periodic test interval.`,
    fr: (accounts) =>
      `Aucun message de la centrale ${accounts} dans l'intervalle du test périodique.`,
  },
  // `configured`: the account numbers in the configuration (array).
  unknownAccount: {
    en: (account, configured) =>
      `A hub sends account ${account}, which is not in the configuration (configured: ${
        configured.join(', ') || 'none'
      }): its messages are refused. Either set "Object number" to ${
        configured.length === 1 ? configured[0] : 'one of the configured numbers'
      } in the Ajax app (space settings → Security companies → Monitoring station), or add ${account} to "Account number(s)" in the configuration of this integration.${
        /^0+$/.test(account)
          ? ` ${account} is what an Ajax hub sends when its object number is empty.`
          : zerosDiffer(account, configured)
            ? ` Numbers are compared as sent, leading zeros included: ${account} and ${zerosDiffer(account, configured)} are two different accounts.`
            : ''
      }`,
    fr: (account, configured) =>
      `Une centrale envoie le compte ${account}, absent de la configuration (configuré : ${
        configured.join(', ') || 'aucun'
      }) : ses messages sont refusés. Saisissez ${
        configured.length === 1 ? configured[0] : "l'un des numéros configurés"
      } dans « Numéro d'objet » de l'application Ajax (paramètres de l'espace → Sociétés de sécurité → Centre de télésurveillance), ou ajoutez ${account} à « Numéro(s) de compte » dans la configuration de cette intégration.${
        /^0+$/.test(account)
          ? ` ${account} est ce qu'envoie une centrale Ajax dont le numéro d'objet est vide.`
          : zerosDiffer(account, configured)
            ? ` Les numéros sont comparés tels quels, zéros de tête compris : ${account} et ${zerosDiffer(account, configured)} sont deux comptes différents.`
            : ''
      }`,
  },
  // `names`: the device names (array), as the Discovery tab lists them.
  deviceMissing: {
    en: (names) =>
      `Hub${names.length > 1 ? 's' : ''} ${names.join(', ')} report${
        names.length > 1 ? '' : 's'
      }, but ${names.length > 1 ? 'their devices are' : 'its device is'} not in Gladys: add ${
        names.length > 1 ? 'them' : 'it'
      } from the Discovery tab (a changed account number is a new device: delete the old one and rebuild its dashboard widgets).`,
    fr: (names) =>
      names.length > 1
        ? `Les centrales ${names.join(', ')} transmettent, mais leurs appareils ne sont pas dans Gladys : ajoutez-les depuis l'onglet Découverte (un numéro de compte changé est un nouvel appareil : supprimez l'ancien et refaites ses widgets du tableau de bord).`
        : `La centrale ${names[0]} transmet, mais son appareil n'est pas dans Gladys : ajoutez-le depuis l'onglet Découverte (un numéro de compte changé est un nouvel appareil : supprimez l'ancien et refaites ses widgets du tableau de bord).`,
  },
  orphanDevice: {
    en: (names) =>
      `Device${names.length > 1 ? 's' : ''} ${names.join(', ')} in Gladys ${
        names.length > 1 ? 'belong' : 'belongs'
      } to an account that is no longer configured: ${
        names.length > 1 ? 'they get' : 'it gets'
      } no state any more. Delete ${names.length > 1 ? 'them' : 'it'} (or add the account back).`,
    fr: (names) =>
      names.length > 1
        ? `Les appareils ${names.join(', ')} de Gladys correspondent à des comptes qui ne sont plus configurés : ils ne reçoivent plus d'état. Supprimez-les (ou remettez les comptes dans la configuration).`
        : `L'appareil ${names[0]} de Gladys correspond à un compte qui n'est plus configuré : il ne reçoit plus d'état. Supprimez-le (ou remettez le compte dans la configuration).`,
  },
  cleared: {
    en: (count) => `Alarm and fault memory cleared (${count} hub${count > 1 ? 's' : ''}).`,
    fr: (count) =>
      `Mémoire des alarmes et défauts effacée (${count} centrale${count > 1 ? 's' : ''}).`,
  },
};
