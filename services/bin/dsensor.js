#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../chaitin__dsensor_ds-s_h_40-25.07.001/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../chaitin__dsensor_ds-s_h_40-25.07.001/bin/dsensor.js", import.meta.url)),
});
