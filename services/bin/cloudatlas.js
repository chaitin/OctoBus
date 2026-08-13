#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../chaitin__cloudatlas/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../chaitin__cloudatlas/bin/cloudatlas.js", import.meta.url)),
});
