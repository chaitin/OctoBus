#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../venus__ips_v6079/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../venus__ips_v6079/bin/venus-ips-v6079.js", import.meta.url)),
});
