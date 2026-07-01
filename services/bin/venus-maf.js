#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../venus__maf/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../venus__maf/bin/venus-maf.js", import.meta.url)),
});
