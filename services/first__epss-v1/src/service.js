import { defineService } from "@chaitin-ai/octobus-sdk";
import { handlers } from "./first-epss-v1.js";
export { handlers } from "./first-epss-v1.js";
export const service = defineService({ handlers });
