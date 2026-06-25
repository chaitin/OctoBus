#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../sangfor__sip/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../sangfor__sip/bin/sangfor-sip.js", import.meta.url)),
});
