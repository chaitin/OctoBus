import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './volcengine-ddos.js';

export { handlers } from './volcengine-ddos.js';

export const service = defineService({ handlers });
