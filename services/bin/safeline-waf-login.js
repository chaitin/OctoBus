#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../chaitin__safeline-waf-login/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../chaitin__safeline-waf-login/bin/safeline-waf-login.js", import.meta.url)),
});
