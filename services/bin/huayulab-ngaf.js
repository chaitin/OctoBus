#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../huayulab__ngaf/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../huayulab__ngaf/bin/huayulab-ngaf.js", import.meta.url)),
});
