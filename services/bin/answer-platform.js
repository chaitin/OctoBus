#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../chaitin__answer-platform_v25-05-001/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../chaitin__answer-platform_v25-05-001/bin/answer-platform.js", import.meta.url)),
});
