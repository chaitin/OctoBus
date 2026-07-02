#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../tophant__xsiem/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../tophant__xsiem/bin/tophant-xsiem.js", import.meta.url)),
});
