#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../cloudflare__waf/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../cloudflare__waf/bin/cloudflare-waf.js", import.meta.url)),
});
