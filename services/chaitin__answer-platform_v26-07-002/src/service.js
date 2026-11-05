import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./answer-platform-v26.js";

export { handlers } from "./answer-platform-v26.js";

export const service = defineService({ handlers });
