import http from "node:http";

export function createMockUpstream(handler) {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    const result = await handler({ req, body });
    res.writeHead(result.status || 200, { "content-type": "application/json" });
    res.end(JSON.stringify(result.body || { Response: { RequestId: "mock-request" } }));
  });
  return server;
}
