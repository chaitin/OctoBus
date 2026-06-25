import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./hfish.js";

export { handlers } from "./hfish.js";

export const service = defineService({ handlers });
