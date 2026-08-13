import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./m01-intelligence.js";

export { handlers } from "./m01-intelligence.js";

export const service = defineService({ handlers });
