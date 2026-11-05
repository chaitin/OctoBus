import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./cloudwalker-cwpp.js";

export { handlers } from "./cloudwalker-cwpp.js";

export const service = defineService({ handlers });
