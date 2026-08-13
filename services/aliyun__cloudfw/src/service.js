import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './aliyun-cloudfw.js';

export { handlers } from './aliyun-cloudfw.js';

export const service = defineService({ handlers });
