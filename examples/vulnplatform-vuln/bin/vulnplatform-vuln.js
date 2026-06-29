#!/usr/bin/env node

import { defineService, runServiceMain } from "@chaitin-ai/octobus-sdk";

const service = defineService({
  handlers: {
    "vulnplatform.v1.VulnerabilityService/ListVulnerabilities": async (ctx) => {
      return { records: [], total: 0, size: 10, current: 1, pages: 0 };
    },
    "vulnplatform.v1.AssetService/ListGroups": async (ctx) => {
      return { groups: [] };
    },
  }
});

runServiceMain(service);