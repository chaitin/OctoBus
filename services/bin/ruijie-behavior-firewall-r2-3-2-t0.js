#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../ruijie__behavior_firewall_r2-3-2-t0/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../ruijie__behavior_firewall_r2-3-2-t0/bin/ruijie-behavior-firewall-r2-3-2-t0.js", import.meta.url)),
});
