import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./cortex.js";

export { handlers } from "./cortex.js";

export const service = defineService({ handlers });
