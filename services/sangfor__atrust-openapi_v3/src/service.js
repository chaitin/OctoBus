import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./sangfor-atrust-openapi-v3.js";

export { handlers } from "./sangfor-atrust-openapi-v3.js";

export const service = defineService({ handlers });
