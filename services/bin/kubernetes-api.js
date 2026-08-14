#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../kubernetes__kubernetes_api/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../kubernetes__kubernetes_api/bin/kubernetes-api.js", import.meta.url)),
});
