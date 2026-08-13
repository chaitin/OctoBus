#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("./tencent-weixin-personal.js", import.meta.url)),
});
