import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './volcengine-seccenter.js';

export { handlers } from './volcengine-seccenter.js';

export const service = defineService({ handlers });
