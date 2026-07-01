import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./venus-maf.js";

export { handlers } from "./venus-maf.js";

export const service = defineService({ handlers });
