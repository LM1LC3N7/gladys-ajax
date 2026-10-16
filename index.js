// -----------------------------------------------------------------------------
// Entry point of the main container: SDK wiring only (src/handlers.js
// registers every handler BEFORE connect(), and delegates to the AjaxApp of
// src/app.js). The SIA receiver runs in the `sia-receiver` sub-container
// (src/receiver.js), started by the app.
//
// Environment variables provided by the Gladys supervisor, read by the SDK:
// GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { AjaxApp } from './src/app.js';
import { registerHandlers } from './src/handlers.js';

const gladys = new GladysIntegration();
const app = new AjaxApp({ gladys, logger });

registerHandlers(gladys, app, logger);
// The receiver keeps running (and keeps what the hubs send) while this one restarts.
gladys.handleShutdown(() => app.stop());

logger.info('Starting the Ajax Systems (SIA DC-09) integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
