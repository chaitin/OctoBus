import http from "node:http";

export const port = Number(process.env.HTTP_PORT || 18083);
export const token = process.env.MOCK_TOKEN || "test-token-abc123";

const sendJSON = (res, statusCode, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });

const sampleHost = (id, name) => ({
  id: String(id),
  name,
  main_ip: "192.168.1.10",
  agent_id: `agent-${id}`,
  agent_status: "online",
  os: { type: "linux", arch: "x86_64", dist: "Ubuntu", version: "22.04", kernel_version: "5.15.0" },
  group: { id: "grp-1", name: "Production" },
  location: "Beijing",
  charger_name: "admin",
  charger_email: "admin@example.com",
  internal_ips: ["192.168.1.10", "10.0.0.10"],
  external_ips: ["203.0.113.10"],
  first_seen: "2025-01-01T00:00:00Z",
  last_seen: "2025-06-01T00:00:00Z",
  last_online_at: "2025-06-01T00:00:00Z",
  last_offline_at: "2025-05-31T00:00:00Z",
  agent_run_mode: "user",
  agent_version: "5.1.5",
  host_type: "physical",
  run_level: "normal",
  client_ip: "192.168.1.100",
});

const sampleAgent = (id) => ({
  agent_id: `agent-${id}`,
  state: "online",
  run_mode: "user",
  hostname: `host-${id}`,
  ip: `192.168.1.${id}`,
  version: "5.1.5",
  run_level: "normal",
  log_level: "info",
  created_at: "2025-01-01T00:00:00Z",
  last_online_at: "2025-06-01T00:00:00Z",
  last_offline_at: "2025-05-31T00:00:00Z",
  last_offline_reason: "heartbeat_timeout",
  driver_state: "loaded",
  driver_run_state: "running",
  os_type: "linux",
  os_dist: "Ubuntu",
  os_version: "22.04",
  os_arch: "x86_64",
  mo_id: `mo-${id}`,
  connection_type: "direct",
  connection_host: "192.168.1.1",
  proxy_ip: "",
  license_status: "valid",
  host_type: "physical",
});

const sampleDetection = (id) => ({
  base_info: {
    detection_id: `det-${id}`,
    detection_code: `DC-${id}`,
    severity: "high",
    status: "pending",
    detection_type: "brute_force",
    detection_type_code: "bf_ssh",
    detection_title: "SSH Brute Force Attack",
    detection_time: "2025-06-01T10:00:00Z",
    last_detection_time: "2025-06-01T12:00:00Z",
    host_ip: "192.168.1.10",
    hostname: "web-server-01",
    agent_id: "agent-1",
    group_name: "Production",
    container_id: "",
    container_name: "",
    cluster_id: "",
    cluster_name: "",
    namespace: "",
    dup_count: 3,
  },
  detail_info: {
    handle_suggestion: "Block source IP and change password",
    action_desc: "Multiple failed SSH login attempts detected",
    detection_response_info: {
      operation_process_element_id: `elem-proc-${id}`,
      operation_file_element_id: `elem-file-${id}`,
    },
  },
});

const sampleResponseResult = (id) => ({
  result_id: `result-${id}`,
  element_id: `elem-${id}`,
  element_type: "process",
  agent_id: "agent-1",
  host_id: "1",
  host_ip: "192.168.1.10",
  hostname: "web-server-01",
  group_name: "Production",
  operation_method: "kill",
  operation_type: "process_kill",
  operation_status: "success",
  operator: "admin",
  reason: "",
  error: "",
  create_time: "2025-06-01T12:00:00Z",
  detection_code: "DC-1",
  detection_id: "det-1",
  source: "manual",
});

const sampleBaseline = (id) => ({
  uuid: `bl-${id}`,
  name: `CIS Benchmark ${id}`,
  category_id: `cat-${id}`,
  category: "Linux",
  cpu_arch: "x86_64",
  active: true,
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-06-01T00:00:00Z",
  check_item_ids: ["chk-1", "chk-2", "chk-3"],
});

const sampleBaselineTask = (id) => ({
  task_id: `task-${id}`,
  name: `Scan Task ${id}`,
  baseline_name: ["CIS Benchmark 1"],
  passed: 0.85,
  last_executed_at: "2025-06-01T00:00:00Z",
  next_executed_at: "2025-07-01T00:00:00Z",
  created_at: "2025-01-01T00:00:00Z",
  is_executing: false,
  cron: "0 0 1 * *",
  editable: true,
});

const sampleBaselineTaskStatus = (id) => ({
  task_id: `task-${id}`,
  is_executing: false,
  last_executed_at: "2025-06-01T00:00:00Z",
  passed: 0.85,
  next_executed_at: "2025-07-01T00:00:00Z",
  task_status: "completed",
  task_status_description_key: "task_completed",
  last_execute_record_id: `rec-${id}`,
});

const sampleBaselineTaskResult = (id) => ({
  uuid: `res-uuid-${id}`,
  task_id: "task-1",
  baseline_id: "bl-1",
  execute_record_id: `rec-1`,
  agent_id: "agent-1",
  check_id: `chk-${id}`,
  code: 1,
  flag: 0,
  error: "",
  data: "pass",
  check_object_id: `obj-${id}`,
  created_at: "2025-06-01T00:00:00Z",
});

const PREFIXES = {
  asset: "/oapi/com-qt-app-asset/service-asset",
  ids: "/oapi/com-qt-app-ids/service-ids",
  baseline: "/oapi/com-qt-app-baseline/service-baseline",
  agent: "/oapi/com-qt-os-agent/service-agent2",
};

export const createMockServer = () =>
  http.createServer(async (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${token}`) {
      sendJSON(res, 401, { error: "unauthorized" });
      return;
    }

    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const path = url.pathname;

    // Asset: hosts
    if (path === `${PREFIXES.asset}/v1/hosts/list` && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      sendJSON(res, 200, {
        data: [sampleHost(1, "web-server-01"), sampleHost(2, "db-server-01")],
        total: 2,
      });
      return;
    }

    if (path === `${PREFIXES.asset}/v1/hosts/count` && req.method === "POST") {
      sendJSON(res, 200, { total: 42 });
      return;
    }

    const hostMatch = path.match(new RegExp(`^${PREFIXES.asset}/v1/hosts/([^/]+)$`));
    if (hostMatch && req.method === "GET") {
      sendJSON(res, 200, sampleHost(1, "web-server-01"));
      return;
    }

    // Agent: agents
    if (path === `${PREFIXES.agent}/v1/host-agent/agents/list` && req.method === "POST") {
      sendJSON(res, 200, {
        data: [sampleAgent(1), sampleAgent(2)],
        total: 2,
      });
      return;
    }

    if (path === `${PREFIXES.agent}/v1/host-agent/agents/count` && req.method === "POST") {
      sendJSON(res, 200, { total: 38 });
      return;
    }

    // IDS: detections
    if (path === `${PREFIXES.ids}/v1/detections` && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      sendJSON(res, 200, {
        total: 1,
        detections: [sampleDetection(1)],
      });
      return;
    }

    // IDS: response results
    if (path === `${PREFIXES.ids}/v1/elements/operation/results` && req.method === "POST") {
      sendJSON(res, 200, {
        total: 1,
        data: [sampleResponseResult(1)],
      });
      return;
    }

    // IDS: response history
    if (path === `${PREFIXES.ids}/v1/elements/operation/history` && req.method === "POST") {
      sendJSON(res, 200, {
        total: 1,
        data: [sampleResponseResult(2)],
      });
      return;
    }

    // IDS: element operation infos
    if (path === `${PREFIXES.ids}/v1/elements/operation/element-infos` && req.method === "POST") {
      sendJSON(res, 200, {
        total: 1,
        data: [sampleResponseResult(3)],
      });
      return;
    }

    // Baseline: baselines
    if (path === `${PREFIXES.baseline}/v1/baselines/list` && req.method === "POST") {
      sendJSON(res, 200, {
        total: 2,
        data: [sampleBaseline(1), sampleBaseline(2)],
      });
      return;
    }

    const baselineMatch = path.match(new RegExp(`^${PREFIXES.baseline}/v1/baselines/([^/]+)$`));
    if (baselineMatch && req.method === "GET") {
      sendJSON(res, 200, sampleBaseline(1));
      return;
    }

    // Baseline: tasks
    if (path === `${PREFIXES.baseline}/v1/tasks/list` && req.method === "POST") {
      sendJSON(res, 200, {
        baseline_task: [sampleBaselineTask(1)],
      });
      return;
    }

    const taskStatusMatch = path.match(new RegExp(`^${PREFIXES.baseline}/v1/tasks/([^/]+)/status$`));
    if (taskStatusMatch && req.method === "GET") {
      sendJSON(res, 200, {
        task_status: [sampleBaselineTaskStatus(1)],
      });
      return;
    }

    const taskResultMatch = path.match(new RegExp(`^${PREFIXES.baseline}/v1/tasks/([^/]+)/results/([^/]+)/list$`));
    if (taskResultMatch && req.method === "POST") {
      sendJSON(res, 200, {
        results: [sampleBaselineTaskResult(1), sampleBaselineTaskResult(2)],
      });
      return;
    }

    sendJSON(res, 404, { error: "not_found", path });
  });

if (process.argv[1] != null && import.meta.url === new URL(process.argv[1], "file:").href) {
  createMockServer().listen(port, "0.0.0.0", () => {
    console.log(`[Qingteng HIDS V5 mock] listening on ${port}`);
  });
}
