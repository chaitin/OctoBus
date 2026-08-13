#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../riversec__waf_26-03/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../riversec__waf_26-03/bin/riversec-waf-26-03.js", import.meta.url)),
});
