import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './tencent-cwp.js';

export { handlers } from './tencent-cwp.js';

export const service = defineService({ handlers });
