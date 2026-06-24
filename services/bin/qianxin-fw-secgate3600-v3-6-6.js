#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../qianxin__fw-secgate3600_v3-6-6/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../qianxin__fw-secgate3600_v3-6-6/bin/qianxin-fw-secgate3600-v3-6-6.js", import.meta.url)),
});
