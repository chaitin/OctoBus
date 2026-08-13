import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./ailpha-platform.js";

export { handlers } from "./ailpha-platform.js";

export const service = defineService({ handlers });
