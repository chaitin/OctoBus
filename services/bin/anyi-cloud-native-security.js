#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../anyi__cloud-native-security/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../anyi__cloud-native-security/bin/anyi-cloud-native-security.js", import.meta.url)),
});
