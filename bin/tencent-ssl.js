#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../tencent__ssl/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../tencent__ssl/bin/tencent-ssl.js", import.meta.url)),
});
