import { defineService } from "@chaitin-ai/octobus-sdk";
import { handlers } from "./dsensor.js";

export { handlers } from "./dsensor.js";
export const service = defineService({ handlers });
