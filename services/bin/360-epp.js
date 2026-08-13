#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../360__360-epp_v10-0-0-08331/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../360__360-epp_v10-0-0-08331/bin/360-epp.js", import.meta.url)),
});
