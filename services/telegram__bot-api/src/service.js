import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./telegram-bot-api.js";

export { handlers } from "./telegram-bot-api.js";

export const service = defineService({ handlers });
