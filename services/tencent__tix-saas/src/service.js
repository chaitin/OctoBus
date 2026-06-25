import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './tencent-tix-saas.js';

export { handlers } from './tencent-tix-saas.js';

export const service = defineService({ handlers });
