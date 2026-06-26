#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../elastic__kibana_7-17-26/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../elastic__kibana_7-17-26/bin/elastic-kibana-7-17-26.js", import.meta.url)),
});
