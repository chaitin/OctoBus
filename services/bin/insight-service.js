#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../chaitin__insight_service/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../chaitin__insight_service/bin/insight-service.js", import.meta.url)),
});
