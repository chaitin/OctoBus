#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../zhizhangyi__mbs/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../zhizhangyi__mbs/bin/zhizhangyi-mbs.js", import.meta.url)),
});
