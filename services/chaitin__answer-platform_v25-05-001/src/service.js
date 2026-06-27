import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './answer-platform.js';

export { handlers } from './answer-platform.js';

export const service = defineService({ handlers });
