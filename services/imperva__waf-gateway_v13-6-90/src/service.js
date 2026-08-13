import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './imperva-waf-gateway-v13-6-90.js';

export { handlers } from './imperva-waf-gateway-v13-6-90.js';

export const service = defineService({ handlers });
