import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./zhizhangyi-mbs.js";

export { handlers } from "./zhizhangyi-mbs.js";

export const service = defineService({ handlers });
