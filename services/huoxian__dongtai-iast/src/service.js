import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./dongtai-iast.js";

export { handlers } from "./dongtai-iast.js";

export const service = defineService({ handlers });
