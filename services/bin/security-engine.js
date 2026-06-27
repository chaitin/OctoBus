#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";
import { service } from "../crowdsec__security-engine/src/service.js";

await runServiceMain(service, {
  argv: process.argv.slice(2),
  entryFile: fileURLToPath(new URL("../crowdsec__security-engine/bin/security-engine.js", import.meta.url)),
});
