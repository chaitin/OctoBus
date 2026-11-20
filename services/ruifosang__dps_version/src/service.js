import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./ruifosang-dps-version.js";

export { handlers } from "./ruifosang-dps-version.js";

export const service = defineService({ handlers });
