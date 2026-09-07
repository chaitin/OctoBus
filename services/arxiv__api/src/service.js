import { defineService } from '@chaitin-ai/octobus-sdk';
import { handlers } from './arxiv-api.js';

export { handlers } from './arxiv-api.js';

export const service = defineService({ handlers });
