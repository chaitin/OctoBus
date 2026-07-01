import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './volcengine-waf.js';

export { handlers } from './volcengine-waf.js';

export const service = defineService({ handlers });
