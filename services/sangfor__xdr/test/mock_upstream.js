#!/usr/bin/env node
import { createServer } from "node:http";

export class MockXdrServer {
  constructor() {
    this.handlers = new Map();
    this.server = null;
    this.requests = [];
  }

  on(method, pathRegex, handler) {
    this.handlers.set(`${method}:${typeof pathRegex === "string" ? pathRegex : pathRegex.source}`, { pathRegex: typeof pathRegex === "string" ? new RegExp(`^${pathRegex}(\\?|$)`) : pathRegex, handler, method });
  }

  async start(port = 0) {
    return new Promise((resolve) => {
      this.server = createServer(async (req, res) => {
        const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
        const body = await readBody(req);
        this.requests.push({ method: req.method, url: url.pathname, query: Object.fromEntries(url.searchParams), body, headers: req.headers });

        for (const [, { pathRegex, handler, method }] of this.handlers) {
          if (req.method === method && pathRegex.test(url.pathname)) {
            const result = handler({ url, body, headers: req.headers, query: Object.fromEntries(url.searchParams) });
            res.writeHead(result.status || 200, { "Content-Type": "application/json", ...(result.headers || {}) });
            res.end(JSON.stringify(result.body || {}));
            return;
          }
        }
        res.writeHead(404);
        res.end(JSON.stringify({ error: "not found" }));
      });
      this.server.listen(port, () => {
        resolve(this.server.address().port);
      });
    });
  }

  get baseUrl() {
    const addr = this.server.address();
    return `http://127.0.0.1:${addr.port}`;
  }

  async stop() {
    return new Promise((resolve) => {
      if (this.server) this.server.close(() => resolve());
      else resolve();
    });
  }
}

async function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(data)); } catch { resolve(data); }
    });
  });
}
