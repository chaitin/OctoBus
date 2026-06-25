#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../alibaba__sas/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../alibaba__sas/bin/alibaba-sas.js", import.meta.url)),
});
