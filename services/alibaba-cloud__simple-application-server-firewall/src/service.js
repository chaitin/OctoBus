import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './alibaba-cloud-simple-application-server-firewall.js';

export { handlers } from './alibaba-cloud-simple-application-server-firewall.js';

export const service = defineService({ handlers });
