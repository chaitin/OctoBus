import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./huayulab-ngaf.js";

export { handlers } from "./huayulab-ngaf.js";

export const service = defineService({ handlers });

