#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../sangfor__af_v8-0-106/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../sangfor__af_v8-0-106/bin/sangfor-af-v8-0-106.js", import.meta.url)),
});
