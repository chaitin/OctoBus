import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './tencent-dasb.js';

export { handlers } from './tencent-dasb.js';

export const service = defineService({ handlers });
