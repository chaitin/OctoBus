import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./tencent-weixin-personal.js";

export { handlers } from "./tencent-weixin-personal.js";

export const service = defineService({ handlers });
