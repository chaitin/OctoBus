import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './apisix.js';

export { handlers } from './apisix.js';

export const service = defineService({ handlers });
