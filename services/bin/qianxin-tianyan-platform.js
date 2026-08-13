#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../qianxin__tianyan-platform/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../qianxin__tianyan-platform/bin/qianxin-tianyan-platform.js", import.meta.url)),
});
