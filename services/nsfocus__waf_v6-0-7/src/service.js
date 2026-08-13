import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./nsfocus-waf-v6-0-7.js";

export { handlers } from "./nsfocus-waf-v6-0-7.js";

export const service = defineService({ handlers });
