#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../vulnplatform__vulnerability-management_v3-2-0/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../vulnplatform__vulnerability-management_v3-2-0/bin/vulnplatform-vuln.js", import.meta.url)),
});
