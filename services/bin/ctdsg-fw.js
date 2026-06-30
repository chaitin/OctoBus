#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../ctdsg__fw/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../ctdsg__fw/bin/ctdsg-fw.js", import.meta.url)),
});
