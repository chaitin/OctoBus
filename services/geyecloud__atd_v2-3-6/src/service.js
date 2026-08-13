import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./geyecloud-atd.js";

export { handlers } from "./geyecloud-atd.js";

export const service = defineService({ handlers });
