#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../ctyun__accessone/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../ctyun__accessone/bin/ctyun-accessone.js", import.meta.url)),
});
