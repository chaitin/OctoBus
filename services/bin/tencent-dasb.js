#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../tencent__dasb/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../tencent__dasb/bin/tencent-dasb.js", import.meta.url)),
});
