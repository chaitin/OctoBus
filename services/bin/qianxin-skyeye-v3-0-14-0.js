#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../qianxin__skyeye_v3.0.14.0/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../qianxin__skyeye_v3.0.14.0/bin/qianxin-skyeye-v3-0-14-0.js", import.meta.url)),
});
