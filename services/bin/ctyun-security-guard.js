#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../ctyun__security-guard/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../ctyun__security-guard/bin/ctyun-security-guard.js", import.meta.url)),
});
