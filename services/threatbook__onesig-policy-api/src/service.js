import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './threatbook-onesig-policy-api.js';

export { handlers } from './threatbook-onesig-policy-api.js';

export const service = defineService({ handlers });
