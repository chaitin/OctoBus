#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../api7__enterprise_v3-10-2/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../api7__enterprise_v3-10-2/bin/api7-enterprise-v3-10-2.js", import.meta.url)),
});
