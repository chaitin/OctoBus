import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './ctyun-accessone.js';

export { handlers } from './ctyun-accessone.js';

export const service = defineService({ handlers });
