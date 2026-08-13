#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../aliyun__cloudfw/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../aliyun__cloudfw/bin/aliyun-cloudfw.js", import.meta.url)),
});
