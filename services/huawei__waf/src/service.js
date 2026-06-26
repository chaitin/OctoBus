import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './huawei-waf.js';

export { handlers } from './huawei-waf.js';

export const service = defineService({ handlers });
