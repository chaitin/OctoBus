import { defineService } from "@chaitin-ai/octobus-sdk";
import { handlers } from "./sangfor-xdr.js";
export { handlers } from "./sangfor-xdr.js";
export const service = defineService({ handlers });
