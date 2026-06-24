import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './qianxin-fw-secgate3600-policy.js';

export { handlers } from './qianxin-fw-secgate3600-policy.js';

export const service = defineService({ handlers });
