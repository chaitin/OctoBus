import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./anyi-cloud-native-security.js";

export { handlers } from "./anyi-cloud-native-security.js";

export const service = defineService({ handlers });
