#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../chaitin__cloudwalker-cwpp/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../chaitin__cloudwalker-cwpp/bin/cloudwalker-cwpp.js", import.meta.url)),
});
