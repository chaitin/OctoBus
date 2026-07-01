#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../owasp__dependency-track-sca_v5-0/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../owasp__dependency-track-sca_v5-0/bin/owasp-dependency-track-sca-v5-0.js", import.meta.url)),
});
