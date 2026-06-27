import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './misp.js';

export { handlers } from './misp.js';

export const service = defineService({ handlers });
