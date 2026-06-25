import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./t-answer-ndr.js";

export { handlers } from "./t-answer-ndr.js";

export const service = defineService({ handlers });
