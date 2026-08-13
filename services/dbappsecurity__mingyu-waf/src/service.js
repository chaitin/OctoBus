import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './waf.js';

export { handlers } from './waf.js';

export const service = defineService({ handlers });
