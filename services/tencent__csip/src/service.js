import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './tencent-csip.js';

export { handlers } from './tencent-csip.js';

export const service = defineService({ handlers });
