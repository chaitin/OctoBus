import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./qingteng-hids-v5.js";

export { handlers } from "./qingteng-hids-v5.js";

export const service = defineService({ handlers });
