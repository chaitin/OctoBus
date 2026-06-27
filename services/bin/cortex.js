#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";
import { service } from "../thehive__cortex/src/service.js";
runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../thehive__cortex/bin/cortex.js", import.meta.url)),
});
