#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../hillstone__waf_v5-5-r12/src/service.mjs";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../hillstone__waf_v5-5-r12/bin/hillstone-waf-v5-5-r12.js", import.meta.url)),
});
