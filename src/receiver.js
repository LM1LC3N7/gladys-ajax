// -----------------------------------------------------------------------------
// Entry point of the `sia-receiver` sub-container (manifest `containers`, same
// image, command `node src/receiver.js`): the main container cannot publish a
// port, this one does. It answers the panels (ACK / NAK / DUH) and hands what
// they sent to the main container through the channel. No Gladys credentials
// here: see src/sia/service.js for the environment it reads.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { startReceiverService } from './sia/service.js';

const logger = createLogger({ name: 'sia-receiver' });

try {
  const service = await startReceiverService({ env: process.env, logger });
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      logger.info(`${signal}: stopping`);
      service.stop().finally(() => process.exit(0));
    });
  }
} catch (err) {
  logger.error('The SIA receiver could not start', err);
  process.exit(1);
}
