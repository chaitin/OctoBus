#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";
import { service } from "../shodan__internetdb/src/service.js";
runServiceMain(service, { entryFile: fileURLToPath(new URL("../shodan__internetdb/bin/shodan-internetdb.js", import.meta.url)) });
