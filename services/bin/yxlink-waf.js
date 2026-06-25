#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../yxlink__waf/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../yxlink__waf/bin/yxlink-waf.js", import.meta.url)),
});
