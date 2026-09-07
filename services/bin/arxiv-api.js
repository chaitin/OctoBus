#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../arxiv__api/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../arxiv__api/bin/arxiv-api.js", import.meta.url)),
});
