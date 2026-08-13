#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../f5__awaf/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../f5__awaf/bin/f5-awaf.js", import.meta.url)),
});
