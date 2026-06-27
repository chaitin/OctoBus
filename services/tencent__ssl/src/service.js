import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './tencent-ssl.js';

export { handlers } from './tencent-ssl.js';

export const service = defineService({ handlers });
