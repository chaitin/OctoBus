import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './ctdsg-fw.js';

export { handlers } from './ctdsg-fw.js';

export const service = defineService({ handlers });
