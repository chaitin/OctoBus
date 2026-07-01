import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './threatbook-ngtip-v5.js';

export { handlers } from './threatbook-ngtip-v5.js';

export const service = defineService({ handlers });
