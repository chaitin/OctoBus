#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../venus__ips/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../venus__ips/bin/venus-ips.js", import.meta.url)),
});
