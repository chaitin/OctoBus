#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../defectdojo__defectdojo/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../defectdojo__defectdojo/bin/defectdojo.js", import.meta.url)),
});
