import { defineService, GrpcError, grpcStatus } from "@chaitin-ai/octobus-sdk";

import {
  configCheck,
  createCronJob,
  createWebhookSubscription,
  disablePlugin,
  disableTools,
  doctor,
  enablePlugin,
  enableTools,
  getComponentStatus,
  getGatewayStatus,
  getLogs,
  getMemoryStatus,
  getSessionsStats,
  listCronJobs,
  listMcpServers,
  listPlugins,
  listSendTargets,
  listSessions,
  listSkills,
  listTools,
  listWebhookSubscriptions,
  pauseCronJob,
  removeCronJob,
  removeWebhookSubscription,
  resumeCronJob,
  runCronJob,
  securityAudit,
  sendMessage,
  testMcpServer,
  testWebhookSubscription,
} from "./hermes-cli.js";
import { healthCheck, HermesClientError, sendWebhook } from "./hermes-client.js";

const STATUS = {
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  UNAUTHENTICATED: grpcStatus.UNAUTHENTICATED,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  DEADLINE_EXCEEDED: grpcStatus.DEADLINE_EXCEEDED,
  FAILED_PRECONDITION: grpcStatus.FAILED_PRECONDITION,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
};

function mapError(error) {
  if (error instanceof HermesClientError) {
    return new GrpcError(STATUS[error.code] || grpcStatus.UNKNOWN, error.message);
  }
  return new GrpcError(grpcStatus.UNKNOWN, error?.message || String(error));
}

function wrap(handler) {
  return async (ctx) => {
    try {
      return await handler(ctx);
    } catch (error) {
      throw mapError(error);
    }
  };
}

export const handlers = {
  "hermes.v1.HermesGateway/HealthCheck": wrap(healthCheck),
  "hermes.v1.HermesGateway/SendWebhook": wrap(sendWebhook),
  "hermes.v1.HermesGateway/GetGatewayStatus": wrap(getGatewayStatus),
  "hermes.v1.HermesGateway/GetComponentStatus": wrap(getComponentStatus),
  "hermes.v1.HermesGateway/ListSendTargets": wrap(listSendTargets),
  "hermes.v1.HermesGateway/ListWebhookSubscriptions": wrap(listWebhookSubscriptions),
  "hermes.v1.HermesGateway/ListCronJobs": wrap(listCronJobs),
  "hermes.v1.HermesGateway/ListPlugins": wrap(listPlugins),
  "hermes.v1.HermesGateway/ListMcpServers": wrap(listMcpServers),
  "hermes.v1.HermesGateway/TestMcpServer": wrap(testMcpServer),
  "hermes.v1.HermesGateway/ListSkills": wrap(listSkills),
  "hermes.v1.HermesGateway/ListTools": wrap(listTools),
  "hermes.v1.HermesGateway/EnableTools": wrap(enableTools),
  "hermes.v1.HermesGateway/DisableTools": wrap(disableTools),
  "hermes.v1.HermesGateway/GetMemoryStatus": wrap(getMemoryStatus),
  "hermes.v1.HermesGateway/ConfigCheck": wrap(configCheck),
  "hermes.v1.HermesGateway/Doctor": wrap(doctor),
  "hermes.v1.HermesGateway/SecurityAudit": wrap(securityAudit),
  "hermes.v1.HermesGateway/CreateWebhookSubscription": wrap(createWebhookSubscription),
  "hermes.v1.HermesGateway/TestWebhookSubscription": wrap(testWebhookSubscription),
  "hermes.v1.HermesGateway/RemoveWebhookSubscription": wrap(removeWebhookSubscription),
  "hermes.v1.HermesGateway/CreateCronJob": wrap(createCronJob),
  "hermes.v1.HermesGateway/PauseCronJob": wrap(pauseCronJob),
  "hermes.v1.HermesGateway/ResumeCronJob": wrap(resumeCronJob),
  "hermes.v1.HermesGateway/RunCronJob": wrap(runCronJob),
  "hermes.v1.HermesGateway/RemoveCronJob": wrap(removeCronJob),
  "hermes.v1.HermesGateway/EnablePlugin": wrap(enablePlugin),
  "hermes.v1.HermesGateway/DisablePlugin": wrap(disablePlugin),
  "hermes.v1.HermesGateway/ListSessions": wrap(listSessions),
  "hermes.v1.HermesGateway/GetSessionsStats": wrap(getSessionsStats),
  "hermes.v1.HermesGateway/GetLogs": wrap(getLogs),
  "hermes.v1.HermesGateway/SendMessage": wrap(sendMessage),
};

export const service = defineService({ handlers });
