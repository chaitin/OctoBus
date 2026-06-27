import { defineService } from '@chaitin-ai/octobus-sdk';
import { handlers } from './alienvault-otx.js';
export { handlers } from './alienvault-otx.js';
export const service = defineService({ handlers });
