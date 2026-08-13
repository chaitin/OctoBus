#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../nsfocus__waf_v6-0-7/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../nsfocus__waf_v6-0-7/bin/nsfocus-waf-v6-0-7.js", import.meta.url)),
});
