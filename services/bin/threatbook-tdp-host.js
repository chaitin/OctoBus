#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../threatbook__tdp-host/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../threatbook__tdp-host/bin/threatbook-tdp-host.js", import.meta.url)),
});
