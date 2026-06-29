import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./venus-waf.js";

export { handlers } from "./venus-waf.js";

export const service = defineService({ handlers });
