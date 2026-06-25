import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './tencent-cfw.js';

export { handlers } from './tencent-cfw.js';

export const service = defineService({ handlers });
