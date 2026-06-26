// Mock EPSS API for tests
import http from "node:http";
const PORT = Number(process.env.HTTP_PORT || 19002);
const log = (...args) => console.log("[mock-epss]", ...args);

const epssDb = new Map();
epssDb.set("CVE-2021-44228", { cve: "CVE-2021-44228", epss: "0.97531", percentile: "0.99990", date: "2026-01-01" });
epssDb.set("CVE-2022-22965", { cve: "CVE-2022-22965", epss: "0.96877", percentile: "0.99948", date: "2026-01-01" });

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method !== "GET") { res.writeHead(405); res.end(); return; }

  if (url.pathname === "/down") {
    res.writeHead(500); res.end("down"); return;
  }

  const cve = url.searchParams.get("cve");
  if (!cve) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "missing cve param" })); return; }

  const ids = cve.split(",");
  const data = ids.map(id => epssDb.get(id) || { cve: id, epss: "0.05", percentile: "0.50000", date: "2026-01-01" });
  log("cve:", cve, "results:", data.length);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ data }));
});

server.listen(PORT, () => log(`listening on :${PORT}`));
