import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './jumpserver-bastionhost-v4-10-16.js';

export { handlers } from './jumpserver-bastionhost-v4-10-16.js';

export const service = defineService({ handlers });
