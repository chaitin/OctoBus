import { createServer } from "node:http";
import { once } from "node:events";

export const mockResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: {
    get: () => "application/json",
  },
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

export async function createXdrMockServer() {
  const requests = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      requests.push({ method: request.method, url: request.url, body });
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ code: "Success", data: { ok: true } }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return {
    requests,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}
