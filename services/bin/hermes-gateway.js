#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../hermes__gateway/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../hermes__gateway/bin/hermes-gateway.js", import.meta.url)),
});
