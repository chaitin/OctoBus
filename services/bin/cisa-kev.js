#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../cisa__kev/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../cisa__kev/bin/cisa-kev.js", import.meta.url)),
});
