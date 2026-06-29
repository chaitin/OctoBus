import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./tencent-qq-chat.js";

export { handlers } from "./tencent-qq-chat.js";

export const service = defineService({ handlers });
