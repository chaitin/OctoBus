#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../huawei__waf/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../huawei__waf/bin/huawei-waf.js", import.meta.url)),
});
