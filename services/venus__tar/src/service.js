import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './venus-tar.js';

export { handlers } from './venus-tar.js';

export const service = defineService({ handlers });
