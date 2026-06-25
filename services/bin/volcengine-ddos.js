#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../volcengine__ddos/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../volcengine__ddos/bin/volcengine-ddos.js", import.meta.url)),
});
