import http from "node:http";
import { pathToFileURL } from "node:url";

const epssDb = new Map();
epssDb.set("CVE-2021-44228", { cve: "CVE-2021-44228", epss: "0.97531", percentile: "0.99990", date: "2026-01-01" });
epssDb.set("CVE-2022-22965", { cve: "CVE-2022-22965", epss: "0.96877", percentile: "0.99948", date: "2026-01-01" });

function buildServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method !== "GET") { res.writeHead(405); res.end(); return; }

    if (url.pathname === "/down") {
      res.writeHead(500); res.end("down"); return;
    }
    if (url.pathname === "/not-json") {
      res.writeHead(200, { "Content-Type": "text/plain" }); res.end("not-json"); return;
    }
    if (url.pathname === "/bad-request") {
      res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "bad cve" })); return;
    }
    if (url.pathname === "/slow") {
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [] }));
      }, 50);
      return;
    }

    const cve = url.searchParams.get("cve");
    if (!cve) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "missing cve param" })); return; }

    const ids = cve.split(",");
    const data = ids.map((id) => epssDb.get(id) || { cve: id, epss: "0.05", percentile: "0.50000", date: "2026-01-01" });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data }));
  });
}

export async function createMockServer() {
  const server = buildServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
    return {
      url: `http://127.0.0.1:${address.port}/epss`,
      badRequestUrl: `http://127.0.0.1:${address.port}/bad-request`,
      downUrl: `http://127.0.0.1:${address.port}/down`,
    notJsonUrl: `http://127.0.0.1:${address.port}/not-json`,
    slowUrl: `http://127.0.0.1:${address.port}/slow`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

if (process.argv[1] != null && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const port = Number(process.env.HTTP_PORT || 19002);
  const server = buildServer();
  server.listen(port, () => {
    console.log(`[mock-epss] listening on :${port}`);
  });
}
