import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./cloudflare-waf.js";

export { handlers } from "./cloudflare-waf.js";

export const service = defineService({ handlers });
