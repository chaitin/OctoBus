import assert from "node:assert/strict";
import { once } from "node:events";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import {
  configCheck,
  createCronJob,
  createWebhookSubscription,
  doctor,
  enableTools,
  listSessions,
  listSendTargets,
  securityAudit,
  sendMessage,
  testWebhookSubscription,
} from "../src/hermes-cli.js";
import { sendWebhook } from "../src/hermes-client.js";
import { handlers } from "../src/service.js";

let server;
let baseUrl;
let lastRequest;

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      lastRequest = { method: req.method, url: req.url, headers: req.headers, body };
      if (req.url === "/api/error") {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "upstream failed" }));
        return;
      }
      if (req.url !== "/api/webhooks/pgs-confirm") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json", "X-Hermes-Event": "accepted" });
      res.end(JSON.stringify({ accepted: true, event_id: "evt-test", topic: "webhook.pgs.confirm.approve" }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  baseUrl = `http://${address.address}:${address.port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

test("SendWebhook posts JSON to an allowed Hermes path and returns evidence", async () => {
  const result = await sendWebhook({
    config: {
      baseUrl,
      defaultPath: "/api/webhooks/pgs-confirm",
      allowedPaths: ["/api/webhooks/*"],
      timeoutMs: 5000,
    },
    secret: {
      authHeaderName: "X-Hermes-Token",
      authHeaderValue: "secret-token",
      webhookHmacSecrets: {
        smoke: "webhook-secret",
      },
    },
    request: {
      payloadJson: JSON.stringify({ report_id: "PGS-20990101", action: "approve" }),
      idempotencyKey: "idem-test",
      correlationId: "corr-test",
      hmacSecretName: "smoke",
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.statusCode, 200);
  assert.equal(lastRequest.method, "POST");
  assert.equal(lastRequest.url, "/api/webhooks/pgs-confirm");
  assert.equal(lastRequest.headers["x-hermes-token"], "secret-token");
  assert.match(lastRequest.headers["x-webhook-signature"], /^[0-9a-f]{64}$/);
  assert.notEqual(lastRequest.headers["x-webhook-signature"], "webhook-secret");
  assert.match(result.requestHeadersJson, /"X-Webhook-Signature": "\*\*\*\*\*\*"/);
  assert.match(result.evidence, /# Request/);
  assert.match(result.evidence, /POST http:\/\/127\.0\.0\.1:/);
  assert.match(result.evidence, /X-Hermes-Token: \*\*\*\*\*\*/);
  assert.match(result.evidence, /X-Webhook-Signature: \*\*\*\*\*\*/);
  assert.match(result.evidence, /# Response/);
  assert.match(result.responseBody, /evt-test/);
});

test("SendWebhook rejects missing named HMAC secrets", async () => {
  await assert.rejects(
    () =>
      sendWebhook({
        config: {
          baseUrl,
          defaultPath: "/api/webhooks/pgs-confirm",
          allowedPaths: ["/api/webhooks/*"],
        },
        secret: {
          webhookHmacSecrets: {},
        },
        request: {
          payloadJson: "{}",
          hmacSecretName: "missing",
        },
      }),
    /webhook HMAC secret 'missing' is not configured/,
  );
});

test("SendWebhook rejects paths outside config.allowedPaths", async () => {
  await assert.rejects(
    () =>
      sendWebhook({
        config: {
          baseUrl,
          defaultPath: "/api/webhooks/pgs-confirm",
          allowedPaths: ["/api/webhooks/pgs-confirm"],
        },
        request: {
          path: "/admin/delete",
          payloadJson: "{}",
        },
      }),
    /not in config\.allowedPaths/,
  );
});

test("SendWebhook skipTlsVerify does not change process-wide TLS verification", async () => {
  const original = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";
  try {
    await assert.rejects(
      () =>
        sendWebhook({
          config: {
            baseUrl: "https://127.0.0.1:1",
            defaultPath: "/api/webhooks/pgs-confirm",
            allowedPaths: ["/api/webhooks/*"],
            skipTlsVerify: true,
            timeoutMs: 1000,
          },
          request: {
            payloadJson: "{}",
          },
        }),
      /fetch failed|request failed|connect|ECONNREFUSED/i,
    );
    assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, "1");
  } finally {
    if (original === undefined) {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    } else {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = original;
    }
  }
});

test("service errors do not expose HTTP evidence in gRPC messages", async () => {
  await assert.rejects(
    () =>
      handlers["hermes.v1.HermesGateway/HealthCheck"]({
        config: {
          baseUrl,
          healthPath: "/api/error",
          allowedPaths: ["/api/*"],
        },
        request: {},
      }),
    (error) => {
      assert.equal(error.message, "{\"error\":\"upstream failed\"}");
      assert.doesNotMatch(error.message, /# Request/);
      assert.doesNotMatch(error.message, /# Response/);
      return true;
    },
  );
});

test("ListSendTargets runs the configured local Hermes CLI", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hermes-cli-test-"));
  const cli = join(dir, "hermes");
  await writeFile(
    cli,
    `#!/usr/bin/env node
if (process.argv.slice(2).join(" ") === "send --list --json") {
  console.log(JSON.stringify({ platforms: { dingtalk: [{ id: "cid-demo", name: "周辛酉", type: "dm" }] } }));
  process.exit(0);
}
console.error("unexpected args", process.argv.slice(2).join(" "));
process.exit(2);
`,
  );
  await chmod(cli, 0o755);

  const result = await listSendTargets({
    config: {
      cliMode: "local",
      cliBinary: cli,
    },
    request: {},
  });

  assert.equal(result.ok, true);
  assert.match(result.stdout, /cid-demo/);
  assert.match(result.evidence, /'send' '--list' '--json'/);
});

test("SendMessage appends DingTalk signature and respects allowedTargets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hermes-send-test-"));
  const cli = join(dir, "hermes");
  const capture = join(dir, "stdin.txt");
  await writeFile(
    cli,
    `#!/usr/bin/env node
const fs = require("node:fs");
const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
  fs.writeFileSync(${JSON.stringify(capture)}, Buffer.concat(chunks).toString("utf8"));
  if (process.argv.slice(2).join(" ") !== "send --to dingtalk:cid-demo --json --file -") {
    console.error("unexpected args", process.argv.slice(2).join(" "));
    process.exit(2);
  }
  console.log(JSON.stringify({ ok: true }));
});
`,
  );
  await chmod(cli, 0o755);

  const result = await sendMessage({
    config: {
      cliMode: "local",
      cliBinary: cli,
      allowedTargets: ["dingtalk:cid-demo"],
      messageSignature: "PGS\nFrom XY@Agent",
    },
    request: {
      target: "dingtalk:cid-demo",
      message: "测试消息",
    },
  });

  assert.equal(result.ok, true);
  assert.equal(await readFile(capture, "utf8"), "测试消息\nPGS\nFrom XY@Agent");

  await sendMessage({
    config: {
      cliMode: "local",
      cliBinary: cli,
      allowedTargets: ["dingtalk:cid-demo"],
      messageSignature: "PGS\nFrom XY@Agent",
    },
    request: {
      target: "dingtalk:cid-demo",
      message: "已有署名\nFrom XY@Agent",
    },
  });

  assert.equal(await readFile(capture, "utf8"), "已有署名\nPGS\nFrom XY@Agent");

  assert.throws(
    () =>
      sendMessage({
        config: {
          cliMode: "local",
          cliBinary: cli,
          allowedTargets: ["dingtalk:cid-demo"],
        },
        request: {
          target: "dingtalk:other",
          message: "nope",
        },
      }),
    /not in config\.allowedTargets/,
  );
});

test("CLI admin wrappers build fixed Hermes command templates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hermes-admin-test-"));
  const cli = join(dir, "hermes");
  const capture = join(dir, "args.json");
  await writeFile(
    cli,
    `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(${JSON.stringify(capture)}, JSON.stringify(process.argv.slice(2)) + "\\n");
console.log(JSON.stringify({ ok: true, args: process.argv.slice(2) }));
`,
  );
  await chmod(cli, 0o755);
  const ctx = {
    config: { cliMode: "local", cliBinary: cli },
    secret: { webhookHmacSecrets: { smoke: "cli-webhook-secret" } },
    request: {},
  };

  const createWebhookResult = await createWebhookSubscription({
    ...ctx,
    request: {
      name: "demo.route",
      prompt: "payload={event.type}",
      events: "approve,reject",
      description: "demo",
      skills: "pgs",
      deliver: "log",
      secretName: "smoke",
      deliverOnly: true,
    },
  });
  assert.match(createWebhookResult.command, /--secret'\s+'\*\*\*\*\*\*'/);
  assert.doesNotMatch(createWebhookResult.command, /cli-webhook-secret/);
  await testWebhookSubscription({ ...ctx, request: { name: "demo.route", payloadJson: "{\"ok\":true}" } });
  await createCronJob({
    ...ctx,
    request: {
      schedule: "*/5 * * * *",
      prompt: "say hi",
      name: "demo cron",
      deliver: "local",
      repeat: 2,
      skills: ["pgs"],
      workdir: "/tmp",
    },
  });
  await enableTools({ ...ctx, request: { platform: "cli", names: ["web", "memory"] } });
  await listSessions({ ...ctx, request: { source: "cli", limit: 5 } });
  await configCheck(ctx);
  await doctor(ctx);
  await securityAudit(ctx);

  const calls = (await readFile(capture, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(calls[0], [
    "webhook",
    "subscribe",
    "demo.route",
    "--prompt",
    "payload={event.type}",
    "--events",
    "approve,reject",
    "--description",
    "demo",
    "--skills",
    "pgs",
    "--deliver",
    "log",
    "--secret",
    "cli-webhook-secret",
    "--deliver-only",
  ]);
  assert.deepEqual(calls[1], ["webhook", "test", "demo.route", "--payload", "{\"ok\":true}"]);
  assert.deepEqual(calls[2], [
    "cron",
    "create",
    "*/5 * * * *",
    "say hi",
    "--name",
    "demo cron",
    "--deliver",
    "local",
    "--repeat",
    "2",
    "--skill",
    "pgs",
    "--workdir",
    "/tmp",
  ]);
  assert.deepEqual(calls[3], ["tools", "enable", "--platform", "cli", "web", "memory"]);
  assert.deepEqual(calls[4], ["sessions", "list", "--source", "cli", "--limit", "5"]);
  assert.deepEqual(calls[5], ["config", "check"]);
  assert.deepEqual(calls[6], ["doctor"]);
  assert.deepEqual(calls[7], ["security", "audit"]);

  assert.throws(
    () => enableTools({ ...ctx, request: { platform: "cli", names: ["bad;tool"] } }),
    /unsupported characters/,
  );
});
