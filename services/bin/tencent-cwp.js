#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../tencent__cwp/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../tencent__cwp/bin/tencent-cwp.js", import.meta.url)),
});
