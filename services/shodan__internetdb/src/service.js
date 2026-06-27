import { defineService } from '@chaitin-ai/octobus-sdk';
import { handlers } from './shodan-internetdb.js';
export { handlers } from './shodan-internetdb.js';
export const service = defineService({ handlers });
