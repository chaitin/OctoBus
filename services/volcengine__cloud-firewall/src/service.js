import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './volcengine-cloud-firewall.js';

export { handlers } from './volcengine-cloud-firewall.js';

export const service = defineService({ handlers });
