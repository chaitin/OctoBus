import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './tencent-bh.js';

export { handlers } from './tencent-bh.js';

export const service = defineService({ handlers });
