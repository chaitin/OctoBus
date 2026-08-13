import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './das-apt.js';

export { handlers } from './das-apt.js';

export const service = defineService({ handlers });
