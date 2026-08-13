import { defineService } from '@chaitin-ai/octobus-sdk';
import { handlers } from './f5-awaf.js';

export { handlers } from './f5-awaf.js';

export const service = defineService({ handlers });
