#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../qianxin__cloudlock_v8-0-8/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../qianxin__cloudlock_v8-0-8/bin/qianxin-cloudlock-v8-0-8.js", import.meta.url)),
});
