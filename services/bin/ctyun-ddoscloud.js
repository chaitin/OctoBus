#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../ctyun__ddoscloud/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../ctyun__ddoscloud/bin/ctyun-ddoscloud.js", import.meta.url)),
});
