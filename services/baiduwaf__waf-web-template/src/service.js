import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./baiduwaf-waf-web-template.js";

export { handlers } from "./baiduwaf-waf-web-template.js";

export const service = defineService({ handlers });
