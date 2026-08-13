import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./360-epp.js";

export { handlers } from "./360-epp.js";

export const service = defineService({ handlers });
