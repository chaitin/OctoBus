#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../qingteng__hids_v5/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../qingteng__hids_v5/bin/qingteng-hids-v5.js", import.meta.url)),
});
