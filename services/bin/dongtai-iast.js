#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../huoxian__dongtai-iast/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../huoxian__dongtai-iast/bin/dongtai-iast.js", import.meta.url)),
});
