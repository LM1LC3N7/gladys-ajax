// -----------------------------------------------------------------------------
// The SDK handlers, wired to the app. Shared by index.js and the tests, so
// the tests run the exact wiring of the container. Whatever publishes states
// runs through app.exclusive, one after the other with the panel messages.
// -----------------------------------------------------------------------------

import { ACTIONS } from './constants.js';

export function registerHandlers(gladys, app, logger) {
  // Discovery: one device per configured account.
  gladys.onScanRequest(() => app.scan());
  gladys.onDeviceCreated(() => app.exclusive(() => app.deviceChanged()));
  gladys.onDeviceUpdated(() => app.exclusive(() => app.deviceChanged()));

  // SIA is one-way: nothing can be commanded.
  gladys.onSetValue(async () => {
    throw new Error('SIA is one-way reporting: the hub cannot be controlled from Gladys');
  });

  // Configuration screen buttons.
  gladys.onAction(ACTIONS.STATUS, () => app.status());
  gladys.onAction(ACTIONS.CLEAR, () => app.exclusive(() => app.clear()));

  // Configuration changed by the user.
  gladys.onConfigUpdated((config) => app.exclusive(() => app.configUpdated(config)));

  // Connection lifecycle: every (re)connection resends devices and states.
  gladys.on('connected', async () => {
    try {
      const config = await gladys.getConfig();
      await app.exclusive(() => app.connected(config));
    } catch (err) {
      logger?.error('Start failed', err);
    }
  });
}
