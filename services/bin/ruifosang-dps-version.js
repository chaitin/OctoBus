#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../ruifosang__dps_version/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../ruifosang__dps_version/bin/ruifosang-dps-version.js", import.meta.url)),
});
