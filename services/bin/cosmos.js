#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../chaitin__cosmos/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../chaitin__cosmos/bin/cosmos.js", import.meta.url)),
});
