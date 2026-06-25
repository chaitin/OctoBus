import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './yxlink-waf.js';

export { handlers } from './yxlink-waf.js';

export const service = defineService({ handlers });
