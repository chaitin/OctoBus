import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./lighthouse-firewall.js";

export { handlers } from "./lighthouse-firewall.js";

export const service = defineService({ handlers });
