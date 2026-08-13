#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";
import { service } from "../dbappsecurity__mingyu-waf/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../dbappsecurity__mingyu-waf/bin/dbappsecurity-mingyu-waf.js", import.meta.url)),
});
