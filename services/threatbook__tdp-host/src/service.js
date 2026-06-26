import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './threatbook-tdp-host.js';

export { handlers } from './threatbook-tdp-host.js';

export const service = defineService({ handlers });
