#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";
import { service } from "../reportedip__reportedip/src/service.js";
runServiceMain(service, { entryFile: fileURLToPath(new URL("../reportedip__reportedip/bin/reportedip.js", import.meta.url)) });
