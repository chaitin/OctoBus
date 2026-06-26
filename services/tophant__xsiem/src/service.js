import { defineService } from "@chaitin-ai/octobus-sdk";
import { handlers } from "./tophant-xsiem.js";
export { handlers } from "./tophant-xsiem.js";
export const service = defineService({ handlers });
