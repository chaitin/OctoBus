#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../topsec__edr/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../topsec__edr/bin/topsec-edr.js", import.meta.url)),
});
