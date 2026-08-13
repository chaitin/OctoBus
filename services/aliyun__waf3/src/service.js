import { defineService } from "@chaitin-ai/octobus-sdk";
import { handlers } from "./waf3.js";

export { handlers } from "./waf3.js";

export const service = defineService({ handlers });
