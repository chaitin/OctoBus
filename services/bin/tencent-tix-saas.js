#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../tencent__tix-saas/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../tencent__tix-saas/bin/tencent-tix-saas.js", import.meta.url)),
});
