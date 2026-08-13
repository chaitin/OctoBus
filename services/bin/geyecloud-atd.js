#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../geyecloud__atd_v2-3-6/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../geyecloud__atd_v2-3-6/bin/geyecloud-atd.js", import.meta.url)),
});
