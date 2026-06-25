import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './ctyun-cloud-firewall-c100.js';

export { handlers } from './ctyun-cloud-firewall-c100.js';

export const service = defineService({ handlers });
