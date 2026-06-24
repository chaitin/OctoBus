#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../wd__k01_v9-0-2/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../wd__k01_v9-0-2/bin/wd-k01-v9-0-2.js", import.meta.url)),
});
