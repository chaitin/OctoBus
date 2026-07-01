import http from "node:http";

export async function startMockUpstream(handler) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const record = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
        json: body ? JSON.parse(body) : {},
      };
      requests.push(record);
      try {
        const response = await handler(record);
        res.statusCode = response?.status ?? 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify(response?.body ?? { errno: 0, errmsg: "", data: {} }));
      } catch (err) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ errno: 3, errmsg: err.message }));
      }
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
