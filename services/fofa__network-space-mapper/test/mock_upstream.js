// Mock upstream for FOFA API
import http from 'node:http';

const httpPort = Number(process.env.HTTP_PORT || 18081);
const log = (...args) => console.log('[mock-fofa]', ...args);

const searchResults = [
  {
    host: 'example.com',
    ip: '1.1.1.1',
    port: 443,
    protocol: 'https',
    app: 'Nginx',
    server: 'nginx/1.18.0',
    country: 'CN',
    region: 'Zhejiang',
    city: 'Hangzhou'
  },
  {
    host: 'test.com',
    ip: '2.2.2.2',
    port: 80,
    protocol: 'http',
    app: 'Apache',
    server: 'Apache/2.4.41',
    country: 'US',
    region: 'California',
    city: 'San Francisco'
  }
];

const hostInfo = {
  host: '1.1.1.1',
  ip: '1.1.1.1',
  ports: [
    { port: 80, protocol: 'http', app: 'Nginx', banner: 'nginx/1.18.0' },
    { port: 443, protocol: 'https', app: 'Nginx', banner: 'nginx/1.18.0' },
    { port: 22, protocol: 'ssh', app: 'OpenSSH', banner: 'OpenSSH_8.2p1' }
  ],
  country: 'CN',
  region: 'Zhejiang',
  city: 'Hangzhou',
  as_number: 12345,
  as_organization: 'Example ISP'
};

const accountInfo = {
  username: 'test@example.com',
  email: 'test@example.com',
  fcoin: 1000,
  vip_level: 1,
  vip_endtime: '2024-12-31T23:59:59Z',
  isvip: true,
  remain_api_query: 999,
  remain_api_data: 99999
};

const statsData = {
  protocol: {
    http: 5000,
    https: 3000,
    ssh: 1000,
    ftp: 500
  },
  port: {
    80: 5000,
    443: 3000,
    22: 1000,
    21: 500
  },
  country: {
    CN: 4000,
    US: 3000,
    JP: 1000,
    DE: 500,
    GB: 500
  }
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Check authentication
  const email = url.searchParams.get('email');
  const key = url.searchParams.get('key');

  if (!email || !key) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: true, errmsg: 'Missing email or key' }));
    return;
  }

  // Search endpoint
  if (req.method === 'GET' && url.pathname === '/search/all') {
    const query = url.searchParams.get('q');
    const page = Number(url.searchParams.get('page')) || 1;
    const size = Number(url.searchParams.get('size')) || 100;
    const fields = url.searchParams.get('fields') || 'host,ip,port,protocol';
    const full = url.searchParams.get('full') === 'true';

    if (!query) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: true, errmsg: 'Missing query parameter' }));
      return;
    }

    log('search', { query, page, size, fields, full });

    const results = searchResults.map(item => {
      const result = {
        host: item.host,
        ip: item.ip,
        port: item.port,
        protocol: item.protocol
      };

      if (full) {
        Object.assign(result, item);
      }

      return result;
    });

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      error: false,
      errmsg: '',
      size: results.length,
      next: page * size < results.length ? 'next-page-token' : '',
      results
    }));
    return;
  }

  // Host info endpoint
  if (req.method === 'GET' && url.pathname === '/info/host') {
    const host = url.searchParams.get('host');
    const detail = url.searchParams.get('detail') === 'true';

    if (!host) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: true, errmsg: 'Missing host parameter' }));
      return;
    }

    log('get host', { host, detail });

    const response = {
      error: false,
      errmsg: '',
      ...hostInfo
    };

    if (!detail) {
      delete response.ports;
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(response));
    return;
  }

  // Account info endpoint
  if (req.method === 'GET' && url.pathname === '/info/my') {
    log('get account info');

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      error: false,
      errmsg: '',
      ...accountInfo
    }));
    return;
  }

  // Stats endpoint
  if (req.method === 'GET' && url.pathname === '/search/stats') {
    const query = url.searchParams.get('q');
    const field = url.searchParams.get('field');

    if (!query || !field) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: true, errmsg: 'Missing query or field parameter' }));
      return;
    }

    const validFields = ['protocol', 'port', 'country', 'region', 'city', 'os', 'app', 'server'];
    if (!validFields.includes(field)) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: true, errmsg: `Invalid field: ${field}` }));
      return;
    }

    log('get stats', { query, field });

    const data = statsData[field] || {};

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      error: false,
      errmsg: '',
      aggregations: data
    }));
    return;
  }

  // 404 for unknown endpoints
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

server.listen(httpPort, () =>
  log(
    `listening on :${httpPort} (GET /search/all, /info/host, /info/my, /search/stats)`
  )
);