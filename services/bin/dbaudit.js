#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../das__dbaudit/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../das__dbaudit/bin/dbaudit.js", import.meta.url)),
});
