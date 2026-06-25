#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../tencent__lighthouse-firewall/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../tencent__lighthouse-firewall/bin/lighthouse-firewall.js", import.meta.url)),
});
