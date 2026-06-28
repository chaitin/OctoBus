import http from 'node:http';

export async function createMockUpstream(handler) {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    const response = await handler({ req, body });
    res.writeHead(response.status ?? 200, response.headers ?? { 'Content-Type': 'application/json' });
    res.end(response.body ?? '{}');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    }),
  };
}
