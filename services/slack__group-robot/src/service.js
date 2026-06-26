import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./slack-group-robot.js";

export { handlers } from "./slack-group-robot.js";

export const service = defineService({ handlers });
