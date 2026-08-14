import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./cosmos.js";

export { handlers } from "./cosmos.js";

export const service = defineService({ handlers });
