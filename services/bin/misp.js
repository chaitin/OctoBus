#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../misp__misp/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../misp__misp/bin/misp.js", import.meta.url)),
});
