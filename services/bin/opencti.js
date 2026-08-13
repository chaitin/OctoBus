#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../filigran__opencti/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../filigran__opencti/bin/opencti.js", import.meta.url)),
});
