import { defineService } from "@chaitin-ai/octobus-sdk";
import { handlers } from "./cisa-kev.js";
export { handlers } from "./cisa-kev.js";
export const service = defineService({ handlers });
