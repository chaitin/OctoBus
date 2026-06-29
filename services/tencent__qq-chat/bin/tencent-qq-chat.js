#!/usr/bin/env node

import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../src/service.js";
import { maybeAutoStartGatewayFromCli } from "../src/tencent-qq-chat.js";

await maybeAutoStartGatewayFromCli();
runServiceMain(service);
