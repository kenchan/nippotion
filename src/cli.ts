import { parseArgs } from 'node:util';
import { t } from './i18n.js';
import { main } from './main.js';

let values: { config?: string; debug?: boolean; help?: boolean };
try {
  ({ values } = parseArgs({
    options: {
      config: { type: 'string', short: 'c' },
      debug: { type: 'boolean', short: 'd', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  }));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(t('cli.help'));
  process.exit(1);
}

if (values.help) {
  console.log(t('cli.help'));
  process.exit(0);
}

// main reads these settings from env vars (NIPPOTION_CONFIG / NIPPOTION_DEBUG),
// so forward the CLI flags by setting the corresponding env vars
if (values.config) process.env.NIPPOTION_CONFIG = values.config;
if (values.debug) process.env.NIPPOTION_DEBUG = '1';

await main();
