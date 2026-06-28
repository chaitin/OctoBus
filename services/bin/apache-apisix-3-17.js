#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../apache__apisix_3-17/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../apache__apisix_3-17/bin/apache-apisix-3-17.js", import.meta.url)),
});
