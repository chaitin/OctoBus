#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../imperva__waf-gateway_v13-6-90/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../imperva__waf-gateway_v13-6-90/bin/imperva-waf-gateway-v13-6-90.js", import.meta.url)),
});
