import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./opencti.js";

export { handlers } from "./opencti.js";

export const service = defineService({ handlers });
