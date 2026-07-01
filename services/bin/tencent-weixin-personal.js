#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../tencent__weixin-personal/src/service.js";
import { maybeAutoStartLoginFromCli, maybeAutoStartReceiverFromCli } from "../tencent__weixin-personal/src/tencent-weixin-personal.js";

await maybeAutoStartLoginFromCli();
await maybeAutoStartReceiverFromCli();

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../tencent__weixin-personal/bin/tencent-weixin-personal.js", import.meta.url)),
});
