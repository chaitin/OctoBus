#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../wazuh__siem/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../wazuh__siem/bin/siem.js", import.meta.url)),
});
