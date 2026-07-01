#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../chaitin__cloudwalker/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../chaitin__cloudwalker/bin/cloudwalker.js", import.meta.url)),
});
