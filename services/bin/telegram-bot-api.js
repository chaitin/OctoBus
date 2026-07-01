#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../telegram__bot-api/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../telegram__bot-api/bin/telegram-bot-api.js", import.meta.url)),
});
