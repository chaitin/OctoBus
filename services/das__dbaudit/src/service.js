import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./dbaudit.js";

export { handlers } from "./dbaudit.js";

export const service = defineService({ handlers });
