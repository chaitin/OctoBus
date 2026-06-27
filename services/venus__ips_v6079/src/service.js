import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './venus-ips-v6079.js';

export { handlers } from './venus-ips-v6079.js';

const adaptHandlerContext = (ctx = {}) => ({
  request: ctx.request ?? {},
  req: ctx.request ?? {},
  metadata: ctx.metadata,
  config: ctx.config ?? {},
  secret: ctx.secret ?? {},
  method: ctx.method ?? '',
  serviceId: ctx.serviceId ?? '',
  instanceId: ctx.instanceId ?? '',
  workdir: ctx.workdir ?? '',
  packageDir: ctx.packageDir ?? '',
  getMetadata: ctx.getMetadata,
  getMetadataAll: ctx.getMetadataAll,
});

const runtimeHandlers = Object.fromEntries(
  Object.entries(handlers).map(([method, handler]) => [
    method,
    (ctx = {}) => handler(ctx.request ?? {}, adaptHandlerContext(ctx)),
  ]),
);

export const service = defineService({ handlers: runtimeHandlers });
