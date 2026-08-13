#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../das__apt/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../das__apt/bin/das-apt.js", import.meta.url)),
});
