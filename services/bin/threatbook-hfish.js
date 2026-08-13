#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../threatbook__hfish/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../threatbook__hfish/bin/threatbook-hfish.js", import.meta.url)),
});
