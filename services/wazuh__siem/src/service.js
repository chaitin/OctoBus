import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./wazuh-siem.js";

export { handlers } from "./wazuh-siem.js";

export const service = defineService({ handlers });
