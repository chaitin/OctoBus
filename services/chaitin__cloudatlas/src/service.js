import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./cloudatlas.js";

export { handlers } from "./cloudatlas.js";

export const service = defineService({ handlers });
