#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../huawei__dns/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../huawei__dns/bin/huawei-dns.js", import.meta.url)),
});
