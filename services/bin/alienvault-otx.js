#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";
import { service } from "../alienvault__otx/src/service.js";
runServiceMain(service, { entryFile: fileURLToPath(new URL("../alienvault__otx/bin/alienvault-otx.js", import.meta.url)) });
