import { defineService } from '@chaitin-ai/octobus-sdk';
import { handlers } from './h3c-secpath.js';
export { handlers } from './h3c-secpath.js';
export const service = defineService({ handlers });
