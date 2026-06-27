import { defineService } from '@chaitin-ai/octobus-sdk';
import { handlers } from './reportedip.js';
export { handlers } from './reportedip.js';
export const service = defineService({ handlers });
