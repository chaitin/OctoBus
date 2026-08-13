#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../bin/das-apt.js", import.meta.url)),
});
