import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './leadsec-tam.js';

export { handlers } from './leadsec-tam.js';

export const service = defineService({ handlers });
