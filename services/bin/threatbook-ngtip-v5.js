#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../threatbook__ngtip_v5/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../threatbook__ngtip_v5/bin/threatbook-ngtip-v5.js", import.meta.url)),
});
