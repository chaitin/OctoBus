import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './tencent-dsgc.js';

export { handlers } from './tencent-dsgc.js';

export const service = defineService({ handlers });
