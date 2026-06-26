import http from "node:http";
const PORT = Number(process.env.HTTP_PORT || 19005);
const log = (...args) => console.log("[mock-xsiem]", ...args);

const alerts = [
  { id: "1001", alarmName: "Apache Log4j RCE", severity: "highRisk", status: "unprocessed", srcAddr: "10.0.0.1", dstAddr: "192.168.1.1", srcPort: "443", dstPort: "8080", devRecTime: "2025-06-01 10:00:00", ruleName: "Log4j Exploit Detection", ruleId: "rule-001", alarmTypeName: ["入侵检测", "漏洞利用"], attackPhase: ["初始访问", "执行"], ruleTag: ["CVE-2021-44228"], evtID: "evt-1001", logTime: "2025-06-01 09:59:00", evtBeginT: "2025-06-01 09:59:00", evtEndT: "2025-06-01 10:00:00", triggerStatus: "basic", rawLog: '{"attack":"Log4j JNDI injection"}' },
  { id: "1002", alarmName: "SQL Injection Attempt", severity: "mediumRisk", status: "processed", srcAddr: "10.0.0.2", dstAddr: "192.168.1.2", srcPort: "556", dstPort: "3306", devRecTime: "2025-06-01 11:00:00", ruleName: "SQL Injection Detection", ruleId: "rule-002", alarmTypeName: ["Web攻击"], attackPhase: ["初始访问"], ruleTag: ["sqli"], evtID: "evt-1002", logTime: "2025-06-01 10:58:00", evtBeginT: "2025-06-01 10:58:00", evtEndT: "2025-06-01 11:00:00", triggerStatus: "basic", rawLog: '{"attack":"union select"}' },
  { id: "1003", alarmName: "Brute Force SSH", severity: "lowRisk", status: "unprocessed", srcAddr: "10.0.0.3", dstAddr: "192.168.1.3", srcPort: "2222", dstPort: "22", devRecTime: "2025-06-01 12:00:00", ruleName: "SSH Brute Force", ruleId: "rule-003", alarmTypeName: ["暴力破解"], attackPhase: ["初始访问"], ruleTag: ["ssh"], evtID: "evt-1003", logTime: "2025-06-01 11:55:00", evtBeginT: "2025-06-01 11:55:00", evtEndT: "2025-06-01 12:00:00", triggerStatus: "basic", rawLog: '{"user":"root"}' },
];

const devices = [
  { id: "dev-001", name: "核心防火墙", sourceName: "syslog", flowStatus: "on", port: 20001, tlp: "tcp", categoryBelongName: "未分组", updatedTime: "2025-06-01 08:00:00" },
  { id: "dev-002", name: "Web服务器日志", sourceName: "syslog", flowStatus: "on", port: 20002, tlp: "tcp", categoryBelongName: "Web组", updatedTime: "2025-06-01 09:00:00" },
];

const collectors = [
  { id: "col-001", name: "采集器-A", sourceName: "syslog", flowStatus: "on", port: 20001, tlp: "tcp", connectorName: "核心防火墙", updatedTime: "2025-06-01 10:00:00", logCount: "1500", failCount: "3" },
  { id: "col-002", name: "采集器-B", sourceName: "kafka", flowStatus: "off", port: 9092, tlp: "tcp", connectorName: "", updatedTime: "2025-06-01 11:00:00", logCount: "0", failCount: "0" },
];

function json(res, obj, code = 200) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

function parseBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(data)); } catch (e) { resolve({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // Token exchange
  if (req.method === "POST" && path === "/api/platform/mmlogin") {
    const body = await parseBody(req);
    if (body.mmToken === "invalid-token") {
      return json(res, { code: 40001, msg: "免密token无效", data: null }, 403);
    }
    log("token exchange ok");
    return json(res, { code: 20000, data: { mmToken: "mock-jwt-token-for-testing" }, msg: "登录成功" });
  }

  // Check auth for /api/xsiem/*
  if (!path.startsWith("/api/xsiem")) {
    res.writeHead(404); res.end("not found"); return;
  }
  if (req.headers.authorization !== "Bearer mock-jwt-token-for-testing") {
    return json(res, { code: 40001, msg: "未授权" }, 401);
  }

  const endpoint = path.replace("/api/xsiem", "");

  // Alert query
  if (req.method === "POST" && endpoint === "/alert/query") {
    const body = await parseBody(req);
    if (body.status === "ERROR_TEST") return json(res, { code: 50001, msg: "server error", detail: "db timeout" }, 500);
    log("alert query", body.page, body.size);
    let filtered = alerts;
    if (body.alarmName) filtered = filtered.filter(a => a.alarmName.includes(body.alarmName));
    if (body.severity) filtered = filtered.filter(a => a.severity === body.severity);
    if (body.status) filtered = filtered.filter(a => a.status === body.status);
    return json(res, { code: 20000, data: filtered, msg: "查询成功" });
  }

  // Alert detail
  if (req.method === "GET" && endpoint.startsWith("/alarm/")) {
    const id = endpoint.split("/alarm/")[1];
    const alert = alerts.find(a => a.id === id);
    if (!alert) return json(res, { code: 40001, msg: "告警不存在" }, 404);
    log("alert detail", id);
    return json(res, { code: 20000, data: alert, msg: "查询成功" });
  }

  // Alert agg count
  if (req.method === "POST" && endpoint === "/alert/aggCount") {
    const body = await parseBody(req);
    log("agg count");
    let count = alerts.length;
    if (body.severity) count = alerts.filter(a => a.severity === body.severity).length;
    return json(res, { code: 20000, data: { count }, msg: "查询成功" });
  }

  // Alert agg detail
  if (req.method === "POST" && endpoint === "/alert/aggDetail") {
    log("agg detail");
    return json(res, {
      code: 20000,
      data: { alarmTypeCount: 3, alarmCount: 3, attackerCount: 3, suffererCount: 3, topKAlarmName: ["Apache Log4j RCE", "SQL Injection Attempt", "Brute Force SSH"] },
      msg: "查询成功",
    });
  }

  // Batch update status
  if (req.method === "PUT" && endpoint === "/alarm/batchStatus") {
    const body = await parseBody(req);
    if (!body.ids || body.ids.length === 0) return json(res, { code: 40001, msg: "ids不能为空" }, 400);
    log("batch update", body.ids, body.status);
    return json(res, { code: 20000, data: null, msg: "操作成功" });
  }

  // Device list
  if (req.method === "POST" && endpoint === "/connector2/page") {
    log("device list");
    return json(res, { code: 20000, data: { total: devices.length, items: devices }, msg: "查询成功" });
  }

  // Collector list
  if (req.method === "POST" && endpoint === "/transform/page") {
    log("collector list");
    return json(res, { code: 20000, data: { total: collectors.length, items: collectors }, msg: "查询成功" });
  }

  res.writeHead(404); res.end("not found");
});

server.listen(PORT, () => log(`listening on :${PORT}`));
