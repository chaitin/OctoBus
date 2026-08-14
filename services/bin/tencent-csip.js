#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../tencent__csip/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../tencent__csip/bin/tencent-csip.js", import.meta.url)),
});
