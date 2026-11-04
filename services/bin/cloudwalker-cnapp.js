#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../chaitin__cloudwalker-cnapp/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../chaitin__cloudwalker-cnapp/bin/cloudwalker-cnapp.js", import.meta.url)),
});
