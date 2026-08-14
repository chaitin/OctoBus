#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../nist__nvd-v2/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../nist__nvd-v2/bin/nist-nvd-v2.js", import.meta.url)),
});
