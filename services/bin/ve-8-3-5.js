#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../proxmox__ve_8-3-5/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../proxmox__ve_8-3-5/bin/ve-8-3-5.js", import.meta.url)),
});