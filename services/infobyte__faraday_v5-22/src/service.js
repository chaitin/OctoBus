import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './infobyte-faraday-v5-22.js';

export { handlers } from './infobyte-faraday-v5-22.js';

export const service = defineService({ handlers });
