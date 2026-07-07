#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../venus__tar/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../venus__tar/bin/venus-tar.js", import.meta.url)),
});
