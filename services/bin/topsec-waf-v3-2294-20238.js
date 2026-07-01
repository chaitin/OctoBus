#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../topsec__waf_v3-2294-20238/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../topsec__waf_v3-2294-20238/bin/topsec-waf-v3-2294-20238.js", import.meta.url)),
});
