#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../fofa__network-space-mapper/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../fofa__network-space-mapper/bin/fofa-network-space-mapper.js", import.meta.url)),
});
