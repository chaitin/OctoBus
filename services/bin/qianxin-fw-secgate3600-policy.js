#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../qianxin__fw-secgate3600-policy/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../qianxin__fw-secgate3600-policy/bin/qianxin-fw-secgate3600-policy.js", import.meta.url)),
});
