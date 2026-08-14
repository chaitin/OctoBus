import http from "node:http";

const port = Number(process.env.HTTP_PORT || 19001);
const cve = {
  id: "CVE-2021-44228",
  descriptions: [{ lang: "en", value: "Apache Log4j2 JNDI RCE" }],
  metrics: {
    cvssMetricV31: [{ cvssData: { baseScore: 10, baseSeverity: "CRITICAL", vectorString: "CVSS:3.1/AV:N" } }],
    cvssMetricV30: [{ cvssData: { baseScore: 9.8, baseSeverity: "CRITICAL" } }],
    cvssMetricV2: [{ cvssData: { baseScore: 9.3 } }],
  },
  weaknesses: [{ description: [{ value: "CWE-20" }, { value: "CWE-400" }] }],
  references: [{ url: "https://example.com", source: "vendor", tags: ["Vendor Advisory"] }],
  configurations: [{ nodes: [{ cpeMatch: [{ criteria: "cpe:2.3:a:apache:log4j:2.0:*:*:*:*:*:*:*" }] }] }],
  published: "2021-12-10T10:15:09.143",
  lastModified: "2024-01-01T00:00:00.000",
};

let transientFailures = 0;
http.createServer((request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  if (request.method !== "GET") return response.writeHead(405).end();
  if (url.pathname === "/health") return response.writeHead(204).end();
  if (url.searchParams.get("keywordSearch") === "AUTH_FAIL") return response.writeHead(403).end("invalid api key");
  if (url.searchParams.get("keywordSearch") === "INVALID") return response.writeHead(400).end("invalid keyword");
  if (url.searchParams.get("keywordSearch") === "RETRY" && transientFailures++ === 0) return response.writeHead(503).end("retry later");
  if (url.searchParams.get("cveId")) {
    const found = url.searchParams.get("cveId") === cve.id;
    return response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ vulnerabilities: found ? [{ cve }] : [], totalResults: found ? 1 : 0 }));
  }
  const keyword = url.searchParams.get("keywordSearch")?.toLowerCase();
  const results = keyword ? [cve].filter((item) => item.descriptions[0].value.toLowerCase().includes(keyword)) : [cve];
  return response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ vulnerabilities: results.map((item) => ({ cve: item })), totalResults: results.length }));
}).listen(port);
