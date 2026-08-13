#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../infobyte__faraday_v5-22/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../infobyte__faraday_v5-22/bin/infobyte-faraday-v5-22.js", import.meta.url)),
});
