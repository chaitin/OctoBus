import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './huawei-dns.js';

export { handlers } from './huawei-dns.js';

export const service = defineService({ handlers });
