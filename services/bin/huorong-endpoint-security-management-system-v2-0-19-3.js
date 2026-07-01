#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../huorong__endpoint-security-management-system_v2-0-19-3/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../huorong__endpoint-security-management-system_v2-0-19-3/bin/huorong-endpoint-security-management-system-v2-0-19-3.js", import.meta.url)),
});
