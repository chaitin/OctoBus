import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './threatbook-claudsandbox-v3.js';

export { handlers } from './threatbook-claudsandbox-v3.js';

export const service = defineService({ handlers });
