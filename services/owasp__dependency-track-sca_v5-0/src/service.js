import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './owasp-dependency-track-sca-v5-0.js';

export { handlers } from './owasp-dependency-track-sca-v5-0.js';

export const service = defineService({ handlers });
