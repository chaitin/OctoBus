#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../nsfocus__rsas_v6-0r04f04sp09/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../nsfocus__rsas_v6-0r04f04sp09/bin/nsfocus-rsas-v6-0r04f04sp09.js", import.meta.url)),
});
