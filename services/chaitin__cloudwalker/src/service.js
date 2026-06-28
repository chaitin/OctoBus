import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './cloudwalker.js';

export { handlers } from './cloudwalker.js';

export const service = defineService({ handlers });
