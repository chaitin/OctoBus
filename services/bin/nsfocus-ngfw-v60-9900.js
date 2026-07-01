#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../nsfocus__ngfw_v60-9900/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../nsfocus__ngfw_v60-9900/bin/nsfocus-ngfw-v60-9900.js", import.meta.url)),
});
