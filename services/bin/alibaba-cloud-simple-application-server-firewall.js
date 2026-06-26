#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../alibaba-cloud__simple-application-server-firewall/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../alibaba-cloud__simple-application-server-firewall/bin/alibaba-cloud-simple-application-server-firewall.js", import.meta.url)),
});
