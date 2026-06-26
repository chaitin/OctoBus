// Mock CISA KEV catalog for tests
import http from "node:http";
const PORT = Number(process.env.HTTP_PORT || 19003);
const log = (...args) => console.log("[mock-kev]", ...args);

const catalog = {
  title: "Known Exploited Vulnerabilities Catalog",
  catalogVersion: "2026.01.01",
  vulnerabilities: [
    {
      cveID: "CVE-2021-44228",
      vendorProject: "Apache",
      product: "Log4j2",
      vulnerabilityName: "Apache Log4j2 Remote Code Execution Vulnerability",
      dateAdded: "2021-12-10",
      shortDescription: "Apache Log4j2 JNDI RCE",
      requiredAction: "Apply updates per vendor instructions.",
      dueDate: "2021-12-24",
      knownRansomwareCampaignUse: "Known",
      notes: "https://nvd.nist.gov/vuln/detail/CVE-2021-44228",
    },
    {
      cveID: "CVE-2022-22965",
      vendorProject: "VMware",
      product: "Spring Framework",
      vulnerabilityName: "Spring Framework JDK 9+ RCE",
      dateAdded: "2022-04-04",
      shortDescription: "Spring MVC or Spring WebFlux RCE via data binding.",
      requiredAction: "Apply updates per vendor instructions.",
      dueDate: "2022-04-25",
      knownRansomwareCampaignUse: "Unknown",
      notes: "",
    },
  ],
};

const htmlResponse = "<html><body><h1>403 Forbidden</h1></body></html>";

const server = http.createServer((req, res) => {
  if (req.method !== "GET") { res.writeHead(405); res.end(); return; }
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/down") {
    res.writeHead(503); res.end(); return;
  }
  if (url.pathname === "/html") {
    res.writeHead(403, { "Content-Type": "text/html" });
    res.end(htmlResponse); return;
  }

  log("catalog requested");
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(catalog));
});

server.listen(PORT, () => log(`listening on :${PORT}`));
