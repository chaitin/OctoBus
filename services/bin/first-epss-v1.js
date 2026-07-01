#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../first__epss-v1/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../first__epss-v1/bin/first-epss-v1.js", import.meta.url)),
});
