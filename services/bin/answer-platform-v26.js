#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../chaitin__answer-platform_v26-07-002/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../chaitin__answer-platform_v26-07-002/bin/answer-platform-v26.js", import.meta.url)),
});
