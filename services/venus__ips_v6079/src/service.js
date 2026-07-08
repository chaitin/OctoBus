import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './venus-ips-v6079.js';

export { handlers } from './venus-ips-v6079.js';

const runtimeHandlers = Object.fromEntries(
  Object.entries(handlers).map(([method, handler]) => [
    method,
    (ctx = {}) => handler(ctx.request ?? {}, ctx),
  ]),
);

export const service = defineService({ handlers: runtimeHandlers });
