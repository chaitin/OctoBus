import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './riversec-handlers.js';

export { handlers } from './riversec-handlers.js';

export const service = defineService({ handlers });
