#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../sangfor__af_v8-0-35r1/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../sangfor__af_v8-0-35r1/bin/sangfor-af-v8-0-35r1.js", import.meta.url)),
});
