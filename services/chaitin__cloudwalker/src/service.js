import { defineService } from '@chaitin-ai/octobus-sdk';

import { createClient } from './cloudwalker.js';

const buildOptions = (ctx = {}) => ({
  baseUrl:
    ctx?.config?.baseUrl ||
    ctx?.bindings?.baseUrl ||
    process.env.CLOUDWALKER_BASE_URL ||
    'http://127.0.0.1:18080',
  token:
    ctx?.secret?.token ||
    ctx?.bindings?.token ||
    process.env.CLOUDWALKER_TOKEN ||
    '',
  cookie:
    ctx?.secret?.cookie ||
    ctx?.bindings?.cookie ||
    process.env.CLOUDWALKER_COOKIE ||
    '',
  referer:
    ctx?.config?.referer ||
    ctx?.secret?.referer ||
    ctx?.bindings?.referer ||
    process.env.CLOUDWALKER_REFERER ||
    '',
});

export const handlers = {
  async ListClusters(request, ctx) {
    return createClient(buildOptions(ctx)).listClusters(request);
  },
  async GetClusterInfo(request, ctx) {
    return createClient(buildOptions(ctx)).getClusterInfo(request);
  },
  async ListClusterVulnEvents(request, ctx) {
    return createClient(buildOptions(ctx)).listClusterVulnEvents(request);
  },
  async GetClusterVulnEvent(request, ctx) {
    return createClient(buildOptions(ctx)).getClusterVulnEvent(request);
  },
  async ListMicroserviceVulnEvents(request, ctx) {
    return createClient(buildOptions(ctx)).listMicroserviceVulnEvents(request);
  },
  async GetMicroserviceVulnEvent(request, ctx) {
    return createClient(buildOptions(ctx)).getMicroserviceVulnEvent(request);
  },
};

export const service = defineService({ handlers });
