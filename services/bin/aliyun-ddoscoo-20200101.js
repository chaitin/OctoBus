#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../aliyun__ddoscoo_20200101/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../aliyun__ddoscoo_20200101/bin/aliyun-ddoscoo-20200101.js", import.meta.url)),
});
