#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../prometheus__prometheus_3-0-1/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../prometheus__prometheus_3-0-1/bin/prometheus-3-0-1.js", import.meta.url)),
});
