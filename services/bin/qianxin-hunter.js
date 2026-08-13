#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../qianxin__hunter_v23-1/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../qianxin__hunter_v23-1/bin/qianxin-hunter.js", import.meta.url)),
});
