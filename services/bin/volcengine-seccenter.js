#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../volcengine__seccenter/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../volcengine__seccenter/bin/volcengine-seccenter.js", import.meta.url)),
});
