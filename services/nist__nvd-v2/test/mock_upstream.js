// Mock NVD API 2.0 for tests
import http from "node:http";
const PORT = Number(process.env.HTTP_PORT || 19001);
const log = (...args) => console.log("[mock-nvd]", ...args);

const cveDb = new Map();
cveDb.set("CVE-2021-44228", {
  id: "CVE-2021-44228",
  descriptions: [{ lang: "en", value: "Apache Log4j2 JNDI RCE" }],
  metrics: {
    cvssMetricV31: [{ cvssData: { baseScore: 10, baseSeverity: "CRITICAL", vectorString: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H" } }],
    cvssMetricV30: [{ cvssData: { baseScore: 10, baseSeverity: "CRITICAL", vectorString: "CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H" } }],
    cvssMetricV2: [{ cvssData: { baseScore: 9.3 } }],
  },
  weaknesses: [{ description: [{ value: "CWE-20" }, { value: "CWE-400" }] }],
  references: [{ url: "https://example.com", source: "vendor", tags: ["Vendor Advisory"] }],
  configurations: [{ nodes: [{ cpeMatch: [{ criteria: "cpe:2.3:a:apache:log4j:2.0:*:*:*:*:*:*:*" }] }] }],
  published: "2021-12-10T10:15:09.143",
  lastModified: "2024-01-01T00:00:00.000",
});

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const cveId = url.searchParams.get("cveId");
  const keyword = url.searchParams.get("keywordSearch");

  if (req.method !== "GET") {
    res.writeHead(405); res.end(JSON.stringify({ error: "Method not allowed" })); return;
  }

  if (!req.headers.apiKey && !req.headers.apikey) {
    if (Math.random() > 0.5) {
      res.writeHead(503, { "Content-Type": "text/html" });
      res.end("<html><body><h1>503 Service Unavailable</h1></body></html>");
      return;
    }
  }

  if (cveId) {
    const cve = cveDb.get(cveId);
    if (!cve) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ vulnerabilities: [], totalResults: 0 }));
      return;
    }
    log("lookup", cveId);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ vulnerabilities: [{ cve }] }));
    return;
  }

  if (keyword === "INVALID") {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid keyword" }));
    return;
  }

  if (keyword === "AUTH_FAIL") {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("invalid api key");
    return;
  }

  const results = keyword ? [...cveDb.values()].filter(c => c.descriptions[0].value.toLowerCase().includes(keyword.toLowerCase())) : [...cveDb.values()];
  log("search", keyword || "(all)", results.length);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ vulnerabilities: results.map(c => ({ cve: c })), totalResults: results.length }));
});

server.listen(PORT, () => log(`listening on :${PORT}`));
