import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./ctdsg-dpdk-v3.js";

export { handlers } from "./ctdsg-dpdk-v3.js";

export const service = defineService({ handlers });

