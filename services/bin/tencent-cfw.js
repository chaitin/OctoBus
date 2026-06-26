#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../tencent__cfw/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../tencent__cfw/bin/tencent-cfw.js", import.meta.url)),
});
