import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './alibaba-sas.js';

export { handlers } from './alibaba-sas.js';

export const service = defineService({ handlers });
