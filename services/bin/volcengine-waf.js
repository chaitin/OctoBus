#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../volcengine__waf/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../volcengine__waf/bin/volcengine-waf.js", import.meta.url)),
});
