#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../ctyun__cloud-firewall-c100/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../ctyun__cloud-firewall-c100/bin/ctyun-cloud-firewall-c100.js", import.meta.url)),
});
