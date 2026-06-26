import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './prometheus-3-0-1.js';

export { handlers } from './prometheus-3-0-1.js';

export const service = defineService({ handlers });