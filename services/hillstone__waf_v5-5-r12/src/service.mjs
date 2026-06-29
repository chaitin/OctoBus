import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const mod = require("./service.js");

export const handlers = mod.handlers;
export const service = mod.service;
