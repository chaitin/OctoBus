import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './ctyun-ddoscloud.js';

export { handlers } from './ctyun-ddoscloud.js';

export const service = defineService({ handlers });
