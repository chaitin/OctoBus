import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./safeline-waf-login.js";

export { handlers } from "./safeline-waf-login.js";

export const service = defineService({ handlers });
