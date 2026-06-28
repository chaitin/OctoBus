#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../sangfor__atrust-openapi_v3/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../sangfor__atrust-openapi_v3/bin/sangfor-atrust-openapi-v3.js", import.meta.url)),
});
