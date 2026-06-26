#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../volcengine__cloud-firewall/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../volcengine__cloud-firewall/bin/volcengine-cloud-firewall.js", import.meta.url)),
});
