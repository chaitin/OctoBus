#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../h3c__secpath/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../h3c__secpath/bin/h3c-secpath.js", import.meta.url)),
});
