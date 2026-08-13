#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../threatbook__claudsandbox_v3/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../threatbook__claudsandbox_v3/bin/threatbook-claudsandbox-v3.js", import.meta.url)),
});
