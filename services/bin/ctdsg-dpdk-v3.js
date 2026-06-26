#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../ctdsg__dpdk_v3/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../ctdsg__dpdk_v3/bin/ctdsg-dpdk-v3.js", import.meta.url)),
});
