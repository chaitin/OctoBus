import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './defectdojo.js';

export { handlers } from './defectdojo.js';

export const service = defineService({ handlers });
