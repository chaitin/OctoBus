import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './venus-ips.js';

export { handlers } from './venus-ips.js';

export const service = defineService({ handlers });
