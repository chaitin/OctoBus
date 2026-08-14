#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../threatbook__onesig-policy-api/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../threatbook__onesig-policy-api/bin/threatbook-onesig-policy-api.js", import.meta.url)),
});
