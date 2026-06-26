#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../huawei__ccm/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../huawei__ccm/bin/huawei-ccm.js", import.meta.url)),
});
