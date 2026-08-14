#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../openobserve__openobserve_v0-15-1/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../openobserve__openobserve_v0-15-1/bin/openobserve-v0-15-1.js", import.meta.url)),
});
