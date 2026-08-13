#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../ailpha__platform/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../ailpha__platform/bin/ailpha-platform.js", import.meta.url)),
});
