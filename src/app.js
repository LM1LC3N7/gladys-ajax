// -----------------------------------------------------------------------------
// AjaxApp: the main container's side.
//
// - starts the `sia-receiver` sub-container with its environment (accounts,
//   key, time skew, channel token), again only when that environment changes;
// - reads what the panels sent through the channel, feeds each account's
//   model, publishes the states (publishStates: an event repeats values) and
//   fires the scene triggers;
// - supervision: a hub silent for two periodic tests is offline;
// - keeps the learned states in /data across restarts.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { ChannelClient } from './channel.js';
import { normalizeConfig, receiverEnv } from './config.js';
import { LIMITS, RECEIVER, SCENE_TRIGGERS, TIMINGS } from './constants.js';
import { accountStates, buildDevice, deviceIds } from './devices.js';
import { MESSAGES, eventText, word } from './i18n.js';
import { applyEvent, clearMemory, describe, modeOf, restoreState } from './model.js';
import { StateStore } from './store.js';

const hash = (object) => createHash('sha256').update(JSON.stringify(object)).digest('hex');
const localized = (entry, ...args) =>
  Object.fromEntries(
    Object.entries(entry).map(([lang, text]) => [
      lang,
      typeof text === 'function' ? text(...args) : text,
    ]),
  );

export class AjaxApp {
  /**
   * @param {object} deps
   * @param {object} deps.gladys the SDK client
   * @param {object} [deps.logger]
   * @param {StateStore} [deps.store]
   * @param {(options) => ChannelClient} [deps.createChannel]
   * @param {() => Date} [deps.now]
   */
  constructor({
    gladys,
    logger,
    store = new StateStore(),
    createChannel = (options) => new ChannelClient(options),
    now = () => new Date(),
    logLevel = process.env.LOG_LEVEL,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.store = store;
    this.createChannel = createChannel;
    this.now = now;
    this.logLevel = logLevel;
    this.config = normalizeConfig({});
    this.data = null;
    this.published = new Map();
    this.lastFullPublish = 0;
    this.receiver = { error: null, info: null, lastRejection: null };
    this.connection = null;
    this.sceneEventTimes = [];
    this.chain = Promise.resolve();
  }

  /**
   * Runs one piece of work after the previous ones: panel messages arrive in bursts,
   * and their states must reach Gladys in the order the hub sent them. Every
   * handler that changes or publishes a state goes through it.
   */
  exclusive(work) {
    const run = this.chain.then(work, work);
    this.chain = run.catch(() => {});
    return run;
  }

  // --- Lifecycle -------------------------------------------------------------

  /** Every SDK (re)connection: config, devices, receiver, channel, states. */
  async connected(rawConfig) {
    await this.load();
    this.config = normalizeConfig(rawConfig);
    this.logConfigProblems();
    await this.publishDevices();
    await this.ensureReceiver();
    this.startChannel();
    this.startTimer();
    this.published.clear();
    await this.publishAll();
    await this.updateConnectionStatus();
  }

  async configUpdated(rawConfig) {
    const before = this.config;
    this.config = normalizeConfig(rawConfig);
    this.logConfigProblems();
    if (before.language !== this.config.language) {
      this.published.clear();
    }
    await this.publishDevices();
    await this.ensureReceiver();
    await this.publishAll();
    await this.updateConnectionStatus();
  }

  async stop() {
    clearInterval(this.timer);
    this.timer = undefined;
    this.channel?.stop();
    await this.persistNow();
  }

  async load() {
    if (this.data) return;
    const saved = await this.store.load();
    this.data = {
      token:
        typeof saved.token === 'string' && saved.token
          ? saved.token
          : randomBytes(24).toString('hex'),
      receiverEnvHash: saved.receiverEnvHash ?? null,
      accounts: Object.fromEntries(
        Object.entries(saved.accounts ?? {}).map(([account, state]) => [
          account,
          restoreState(state),
        ]),
      ),
    };
    if (!saved.token) await this.persistNow();
  }

  logConfigProblems() {
    const { invalidAccounts, keyError, accounts } = this.config;
    if (invalidAccounts.length > 0) {
      this.logger?.warn(
        `Ignored account number(s) ${invalidAccounts.join(', ')}: 3 to 16 hexadecimal digits expected`,
      );
    }
    if (keyError) {
      this.logger?.warn(`Encryption key ignored: ${keyError}`);
    }
    if (accounts.length === 0) {
      this.logger?.info('No account number configured yet: every message is refused');
    }
  }

  stateOf(account) {
    this.data.accounts[account] ??= restoreState(null);
    return this.data.accounts[account];
  }

  persist() {
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.persistNow(), TIMINGS.persistDelay);
    this.persistTimer.unref?.();
  }

  async persistNow() {
    clearTimeout(this.persistTimer);
    if (!this.data) return;
    try {
      await this.store.save(this.data);
    } catch (err) {
      this.logger?.warn(`Could not save the state in /data: ${err.message}`);
    }
  }

  // --- The receiver sub-container --------------------------------------------

  /** Starts (or recreates) the receiver when it is not running with the current environment. */
  async ensureReceiver() {
    const env = receiverEnv(this.config, this.data.token, this.logLevel);
    const envHash = hash(env);
    try {
      const containers = await this.gladys.getContainers();
      const current = containers.find((container) => container.name === RECEIVER.name);
      if (current?.status === 'running' && this.data.receiverEnvHash === envHash) {
        this.receiver.error = null;
        return false;
      }
      await this.gladys.startContainer(RECEIVER.name, { env });
      this.logger?.info(
        `SIA receiver started for ${this.config.accounts.length} account(s)${
          this.config.key ? ', encrypted' : ''
        }`,
      );
      this.data.receiverEnvHash = envHash;
      this.receiver.error = null;
      this.persist();
      return true;
    } catch (err) {
      this.receiver.error = err.message;
      this.logger?.error('Could not start the SIA receiver container', err);
      return false;
    }
  }

  startChannel() {
    if (this.channel) return;
    this.channel = this.createChannel({
      host: RECEIVER.name,
      port: RECEIVER.channelPort,
      token: this.data.token,
      logger: this.logger,
    });
    this.channel.on('up', (info) => {
      this.receiver.info = info;
      this.logger?.info(
        `Connected to the SIA receiver${info?.queued ? ` (${info.queued} message(s) kept)` : ''}`,
      );
      this.updateConnectionStatus().catch(() => {});
    });
    this.channel.on('down', () => {
      this.logger?.warn('Lost the SIA receiver, reconnecting');
      this.updateConnectionStatus().catch(() => {});
    });
    this.channel.on('message', (message) =>
      this.exclusive(() => this.onChannelMessage(message)).catch((err) =>
        this.logger?.error('Could not handle a message of the receiver', err),
      ),
    );
    this.channel.start();
  }

  async onChannelMessage(message) {
    if (message?.type === 'message') {
      await this.onPanelMessage(message);
    } else if (message?.type === 'rejected') {
      this.receiver.lastRejection = message;
      if (message.reason === 'unknown_account' && message.account) {
        this.logger?.warn(
          `A panel reports with account ${message.account}, which is not in the configuration: add it there`,
        );
      }
    } else if (message?.type === 'status') {
      this.receiver.info = message;
    }
  }

  // --- Panel messages ----------------------------------------------------------

  async onPanelMessage(message) {
    const account = String(message.account ?? '').toUpperCase();
    if (!this.config.accounts.includes(account)) {
      this.logger?.debug(`Message for account ${account}, no longer configured: ignored`);
      return;
    }
    const received = new Date(message.receivedAt ?? this.now());
    const at = Number.isNaN(received.getTime()) ? this.now() : received;
    let state = this.stateOf(account);
    if (!state.lastSeen || new Date(state.lastSeen) < at) {
      state.lastSeen = at.toISOString();
    }

    const effects = [];
    if (state.offline) {
      effects.push({ type: 'restore', kind: 'offline', zone: 0, reason: 'online' });
    }
    state.offline = false;
    if (!message.duplicate) {
      for (const event of message.events ?? []) {
        const result = applyEvent(state, event, { at });
        state = result.state;
        effects.push(...result.effects);
      }
    }
    this.data.accounts[account] = state;
    this.persist();

    const hasEvents = !message.duplicate && (message.events ?? []).length > 0;
    await this.publishAccount(account, { forceLastEvent: hasEvents });
    for (const effect of effects) {
      if (effect.type === 'mode') {
        this.logger?.info(
          `Hub ${account}: ${effect.previous} -> ${effect.mode} (${effect.event.code})`,
        );
      } else if (effect.type === 'alarm') {
        this.logger?.warn(
          `Hub ${account}: ${effect.kind} alarm, zone ${effect.zone} (${effect.event.code})`,
        );
      }
    }
    if (this.now().getTime() - at.getTime() > TIMINGS.staleEvent) {
      this.logger?.info(`Hub ${account}: old message (${at.toISOString()}), no scene event`);
      return;
    }
    await this.fireEffects(account, effects);
  }

  // --- Supervision -------------------------------------------------------------

  /** Online: a message within two periodic tests (plus a grace); any message ever without supervision. */
  isOnline(account) {
    const state = this.data?.accounts[account];
    if (!state?.lastSeen) return false;
    if (this.config.pingInterval === 0) return true;
    const silence = this.now().getTime() - new Date(state.lastSeen).getTime();
    return silence <= 2 * this.config.pingInterval * 60_000 + TIMINGS.offlineGrace;
  }

  startTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.exclusive(() => this.tick()).catch((err) =>
        this.logger?.error('Supervision failed', err),
      );
    }, TIMINGS.tick);
    this.timer.unref?.();
  }

  async tick() {
    for (const account of this.config.accounts) {
      const state = this.stateOf(account);
      const online = this.isOnline(account);
      if (!online && state.lastSeen && !state.offline) {
        state.offline = true;
        this.persist();
        this.logger?.warn(`Hub ${account}: no message since ${state.lastSeen}, offline`);
        await this.publishAccount(account);
        await this.fireEffects(account, [{ type: 'fault', kind: 'offline', zone: 0 }]);
      }
    }
    if (this.now().getTime() - this.lastFullPublish >= TIMINGS.stateHeartbeat) {
      this.published.clear();
      await this.publishAll();
    }
    await this.updateConnectionStatus();
  }

  async updateConnectionStatus() {
    const { accounts, keyError } = this.config;
    let status;
    if (accounts.length === 0) {
      status = [false, MESSAGES.noAccount];
    } else if (keyError) {
      status = [false, localized(MESSAGES.keyError, keyError)];
    } else if (this.receiver.error) {
      status = [false, localized(MESSAGES.receiverError, this.receiver.error)];
    } else if (!this.channel?.connected) {
      status = [false, MESSAGES.receiverDown];
    } else {
      const neverSeen = accounts.filter((account) => !this.data.accounts[account]?.lastSeen);
      const silent = accounts.filter(
        (account) => this.data.accounts[account]?.lastSeen && !this.isOnline(account),
      );
      if (silent.length > 0) {
        status = [false, localized(MESSAGES.silent, silent.join(', '))];
      } else if (neverSeen.length > 0) {
        status = [false, localized(MESSAGES.neverSeen, neverSeen.join(', '))];
      } else {
        status = [true, undefined];
      }
    }
    const key = JSON.stringify(status);
    if (key === this.connection) return;
    this.connection = key;
    try {
      await this.gladys.setConnectionStatus(status[0], status[1]);
    } catch (err) {
      this.connection = null;
      this.logger?.debug(`Connection status not sent: ${err.message}`);
    }
  }

  // --- Devices and states ------------------------------------------------------

  async publishDevices() {
    const devices = this.config.accounts.map((account) =>
      buildDevice(this.gladys, account, this.config.language),
    );
    await this.gladys.publishDiscoveredDevices(devices);
  }

  async scan() {
    await this.publishDevices();
  }

  /** A device was created or changed: Gladys dropped the states of features it did not have. */
  async deviceChanged() {
    this.published.clear();
    await this.publishAll();
  }

  async publishAll() {
    this.lastFullPublish = this.now().getTime();
    for (const account of this.config.accounts) {
      await this.publishAccount(account);
    }
  }

  /** The states of one account that changed since last sent (the last event always, after events). */
  async publishAccount(account, { forceLastEvent = false } = {}) {
    const states = accountStates(this.gladys, account, this.stateOf(account), {
      online: this.isOnline(account),
      language: this.config.language,
    });
    const lastEventId = deviceIds(this.gladys, account).feature('last-event');
    const changed = states.filter((entry) => {
      const value = entry.text ?? entry.state;
      const forced = forceLastEvent && entry.device_feature_external_id === lastEventId;
      return forced || this.published.get(entry.device_feature_external_id) !== value;
    });
    if (changed.length === 0) return;
    try {
      await this.gladys.publishStates(changed);
      for (const entry of changed) {
        this.published.set(entry.device_feature_external_id, entry.text ?? entry.state);
      }
    } catch (err) {
      this.logger?.warn(`Could not publish the states of hub ${account}: ${err.message}`);
    }
  }

  // --- Scene events ------------------------------------------------------------

  sceneEventAllowed() {
    const now = this.now().getTime();
    this.sceneEventTimes = this.sceneEventTimes.filter((time) => now - time < 60_000);
    if (this.sceneEventTimes.length >= LIMITS.sceneEventsPerMinute) return false;
    this.sceneEventTimes.push(now);
    return true;
  }

  async fireEffects(account, effects) {
    const device = deviceIds(this.gladys, account).device;
    const state = this.stateOf(account);
    const language = this.config.language;
    for (const effect of effects) {
      const parts = effect.event ? describe(effect.event) : null;
      const description = parts
        ? eventText(parts, language)
        : word({ fr: 'Supervision', en: 'Supervision' }, language);
      const common = { device, account, code: parts?.code ?? null, description };
      let key;
      let data;
      switch (effect.type) {
        case 'mode':
          key = SCENE_TRIGGERS.MODE_CHANGED;
          data = {
            ...common,
            mode: effect.mode,
            previous_mode: effect.previous,
            user: parts.user,
            group: parts.group,
          };
          break;
        case 'alarm':
          key = SCENE_TRIGGERS.ALARM;
          data = {
            ...common,
            kind: effect.kind,
            zone: effect.zone,
            group: parts.group,
            user: parts.user,
            mode: modeOf(state),
          };
          break;
        case 'fault':
          key = SCENE_TRIGGERS.FAULT;
          data = { ...common, kind: effect.kind, zone: effect.zone };
          break;
        case 'restore':
          key = SCENE_TRIGGERS.RESTORE;
          data = { ...common, kind: effect.kind, zone: effect.zone };
          break;
        case 'event':
          key = SCENE_TRIGGERS.EVENT;
          data = {
            ...common,
            zone: parts.zone,
            user: parts.user,
            group: parts.group,
            text: parts.text,
          };
          break;
        default:
          continue;
      }
      if (!this.sceneEventAllowed()) {
        this.logger?.warn(`Too many scene events this minute: ${key} of hub ${account} dropped`);
        continue;
      }
      try {
        await this.gladys.publishSceneEvent(key, data);
      } catch (err) {
        this.logger?.warn(`Scene event ${key} not sent: ${err.message}`);
      }
    }
  }

  // --- Buttons -----------------------------------------------------------------

  async clear() {
    for (const account of this.config.accounts) {
      this.data.accounts[account] = clearMemory(this.stateOf(account));
      await this.publishAccount(account);
    }
    this.persist();
    this.logger?.info('Alarm and fault memory cleared from the configuration screen');
    return localized(MESSAGES.cleared, this.config.accounts.length);
  }

  /** What the receiver and each hub look like now, as a text for the button. */
  async status() {
    let ports = [];
    try {
      const containers = await this.gladys.getContainers();
      ports = containers.find((container) => container.name === RECEIVER.name)?.ports ?? [];
    } catch {
      // shown as unknown
    }
    const portOf = (name) => ports.find((port) => port.name === name)?.host_port ?? '?';
    const result = {};
    for (const language of ['en', 'fr']) {
      const lines = [];
      const fr = language === 'fr';
      lines.push(
        (fr ? 'Récepteur SIA : ' : 'SIA receiver: ') +
          (this.receiver.error
            ? (fr ? 'erreur, ' : 'error, ') + this.receiver.error
            : this.channel?.connected
              ? fr
                ? 'connecté'
                : 'connected'
              : fr
                ? 'non joignable'
                : 'not reachable') +
          ` (TCP ${portOf(RECEIVER.tcpPortName)}, UDP ${portOf(RECEIVER.udpPortName)}).`,
      );
      if (this.config.accounts.length === 0) {
        lines.push(word(MESSAGES.noAccount, language));
      }
      for (const account of this.config.accounts) {
        const state = this.stateOf(account);
        const seen = state.lastSeen
          ? new Date(state.lastSeen).toLocaleString(fr ? 'fr-FR' : 'en-GB')
          : fr
            ? 'jamais'
            : 'never';
        lines.push(
          `${fr ? 'Centrale' : 'Hub'} ${account}${fr ? ' :' : ':'} ${modeOf(state)}, ${
            this.isOnline(account) ? (fr ? 'joignable' : 'reporting') : fr ? 'muette' : 'silent'
          }, ${fr ? 'dernier message' : 'last message'} ${seen}${
            state.lastEvent ? `, ${eventText(state.lastEvent, language)}` : ''
          }.`,
        );
      }
      const rejection = this.receiver.lastRejection;
      if (rejection) {
        lines.push(`${fr ? 'Dernier refus' : 'Last refusal'}: ${rejection.problem}`);
      }
      result[language] = lines.join(' ');
    }
    return result;
  }
}
