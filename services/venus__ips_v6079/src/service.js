import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './venus-ips-v6079.js';

export { handlers } from './venus-ips-v6079.js';
export const service = defineService({ handlers });
