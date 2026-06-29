#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../leadsec__waf/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../leadsec__waf/bin/leadsec-waf.js", import.meta.url)),
});
