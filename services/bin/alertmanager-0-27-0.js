#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../prometheus__alertmanager_0-27-0/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../prometheus__alertmanager_0-27-0/bin/alertmanager-0-27-0.js", import.meta.url)),
});
