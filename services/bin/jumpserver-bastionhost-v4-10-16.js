#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../jumpserver__bastionhost_v4-10-16/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../jumpserver__bastionhost_v4-10-16/bin/jumpserver-bastionhost-v4-10-16.js", import.meta.url)),
});
