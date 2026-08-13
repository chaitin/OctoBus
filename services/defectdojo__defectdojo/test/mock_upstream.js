#!/usr/bin/env node

import http from 'node:http';

const port = Number(process.env.PORT || 18080);

const payloads = {
  '/api/v2/products/': {
    count: 1,
    next: null,
    previous: null,
    results: [{ id: 1, name: 'demo-product' }],
  },
  '/api/v2/engagements/': {
    count: 1,
    next: null,
    previous: null,
    results: [{ id: 2, name: 'demo-engagement', product: 1 }],
  },
  '/api/v2/findings/': {
    count: 1,
    next: null,
    previous: null,
    results: [{ id: 3, title: 'demo-finding', severity: 'High' }],
  },
  '/api/v2/findings/3/': {
    id: 3,
    title: 'demo-finding',
    severity: 'High',
  },
};

const server = http.createServer((req, res) => {
  if (req.headers.authorization !== 'Token secret-token') {
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ detail: 'forbidden' }));
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const payload = payloads[url.pathname];
  if (!payload) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ detail: 'not found' }));
    return;
  }

  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
});

server.listen(port, () => {
  process.stderr.write(`DefectDojo mock upstream listening on ${port}\n`);
});
