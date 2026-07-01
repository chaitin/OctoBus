#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";

import { service } from "../slack__group-robot/src/service.js";

runServiceMain(service, {
  entryFile: fileURLToPath(new URL("../slack__group-robot/bin/slack-group-robot.js", import.meta.url)),
});
