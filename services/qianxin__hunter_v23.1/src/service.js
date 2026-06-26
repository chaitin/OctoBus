import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./hunter.js";

export { handlers } from "./hunter.js";

export const service = defineService({ handlers });
