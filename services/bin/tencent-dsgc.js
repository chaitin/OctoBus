#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../tencent__dsgc/src/service.js";

await runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../tencent__dsgc/bin/tencent-dsgc.js", import.meta.url)),
});
