#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../sangfor__fw_v8-0-95/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../sangfor__fw_v8-0-95/bin/sangfor-fw-v8-0-95.js", import.meta.url)),
});
