#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../tencent__bh/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../tencent__bh/bin/tencent-bh.js", import.meta.url)),
});
