#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../tencent__qq-chat/src/service.js";
import { maybeAutoStartGatewayFromCli } from "../tencent__qq-chat/src/tencent-qq-chat.js";

await maybeAutoStartGatewayFromCli();
runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../tencent__qq-chat/bin/tencent-qq-chat.js", import.meta.url)),
});
