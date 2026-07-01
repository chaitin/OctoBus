#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../sangfor__xdr_v2-0-45/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../sangfor__xdr_v2-0-45/bin/sangfor-xdr-v2-0-45.js", import.meta.url)),
});
