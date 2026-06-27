import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./security-engine.js";

export { handlers } from "./security-engine.js";

export const service = defineService({ handlers });
