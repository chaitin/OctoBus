#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../chaitin__t-answer-ndr/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../chaitin__t-answer-ndr/bin/t-answer-ndr.js", import.meta.url)),
});
