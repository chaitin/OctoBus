#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../aliyun__waf3/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../aliyun__waf3/bin/aliyun-waf3.js", import.meta.url)),
});
