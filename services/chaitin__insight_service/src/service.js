import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./insight-service.js";

export { handlers } from "./insight-service.js";

export const service = defineService({ handlers });
