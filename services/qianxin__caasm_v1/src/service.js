import { defineService } from "@chaitin-ai/octobus-sdk";

import { createClient } from "./client.js";
import { buildRequestBody, buildPageResponse, API_PATHS, MAX_LIMITS } from "./mappers.js";

function makeHandler(path, limitProfile = "default") {
  const maxLimit = MAX_LIMITS[limitProfile] ?? MAX_LIMITS.default;
  const skipPagination = limitProfile === "noPagination";
  return async (ctx) => {
    const client = createClient(ctx.config, ctx.secret);
    const body = skipPagination ? {} : buildRequestBody(ctx.request, { maxLimit });
    const pageParams = skipPagination
      ? { offset: Number(ctx.request.offset) || 0, limit: Math.min(Number(ctx.request.limit) || 10, maxLimit) }
      : { offset: body.offset, limit: body.limit };
    return buildPageResponse(await client(path, body), pageParams);
  };
}

export const service = defineService({ handlers: {
  "AssetService/GetDevices": makeHandler(API_PATHS.dev),
  "AssetService/GetSoftware": makeHandler(API_PATHS.software, "largeTable"),
  "AssetService/GetServices": makeHandler(API_PATHS.service, "largeTable"),
  "AssetService/GetComponents": makeHandler(API_PATHS.component, "largeTable"),
  "AssetService/GetWebsites": makeHandler(API_PATHS.website),
  "VulnerabilityService/GetSysVulnerabilities": makeHandler(API_PATHS.vulnSys),
  "VulnerabilityService/GetSysWeakPasswords": makeHandler(API_PATHS.weakpwdSys),
  "VulnerabilityService/GetWebVulnerabilities": makeHandler(API_PATHS.vulnWeb),
  "VulnerabilityService/GetWebWeakPasswords": makeHandler(API_PATHS.weakpwdWeb),
  "AdminService/GetUsers": makeHandler(API_PATHS.user, "noPagination"),
  "AdminService/GetOrganizations": makeHandler(API_PATHS.org, "noPagination"),
  "AdminService/GetRoles": makeHandler(API_PATHS.role),
} });
