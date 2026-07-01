import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './huawei-ccm.js';

export { handlers } from './huawei-ccm.js';

export const service = defineService({ handlers });
