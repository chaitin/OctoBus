import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './sangfor-sip.js';

export { handlers } from './sangfor-sip.js';

export const service = defineService({ handlers });
