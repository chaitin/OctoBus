import { defineService } from "@chaitin-ai/octobus-sdk";
import { handlers } from "./nist-nvd-v2.js";
export { handlers } from "./nist-nvd-v2.js";
export const service = defineService({ handlers });
