#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../baiduwaf__waf-web-template/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../baiduwaf__waf-web-template/bin/baiduwaf-waf-web-template.js", import.meta.url)),
});
