import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './ctyun-security-guard.js';

export { handlers } from './ctyun-security-guard.js';

export const service = defineService({ handlers });
