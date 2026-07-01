import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./fofa.js";

export { handlers } from "./fofa.js";

export const service = defineService({ handlers });