#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../nsfocus__ids_v5-6-r10-f02/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../nsfocus__ids_v5-6-r10-f02/bin/nsfocus-ids-v5-6-r10-f02.js", import.meta.url)),
});
