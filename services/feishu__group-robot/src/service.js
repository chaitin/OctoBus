import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers as approvalHandlers } from "./feishu-open-api.js";
import { handlers as groupRobotHandlers } from "./feishu-group-robot.js";

export const handlers = { ...groupRobotHandlers, ...approvalHandlers };

export const service = defineService({ handlers });
