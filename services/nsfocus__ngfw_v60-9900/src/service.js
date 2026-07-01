import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./nsfocus-ngfw-v60-9900.js";

export { handlers } from "./nsfocus-ngfw-v60-9900.js";

export const service = defineService({ handlers });
