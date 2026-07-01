#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../leadsec__tam/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../leadsec__tam/bin/leadsec-tam.js", import.meta.url)),
});
