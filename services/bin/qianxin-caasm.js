#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { runServiceMain } from "@chaitin-ai/octobus-sdk";
import { service } from "../qianxin__caasm_v1/src/service.js";
runServiceMain(service, { entryFile: fileURLToPath(new URL("../qianxin__caasm_v1/bin/qianxin-caasm.js", import.meta.url)) });
