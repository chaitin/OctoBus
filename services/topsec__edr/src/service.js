import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './topsec-edr.js';

export { handlers } from './topsec-edr.js';

export const service = defineService({ handlers });
