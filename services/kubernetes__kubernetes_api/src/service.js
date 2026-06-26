import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './kubernetes-api.js';

export { handlers } from './kubernetes-api.js';

export const service = defineService({ handlers });