#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../m01__intelligence/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../m01__intelligence/bin/m01-intelligence.js", import.meta.url)),
});
