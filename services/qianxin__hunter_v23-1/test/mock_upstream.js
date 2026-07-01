// Mock upstream for QiAnXin Hunter openApi/search
import http from 'node:http';

const httpPort = Number(process.env.HTTP_PORT || 18081);
const log = (...args) => console.log('[mock-hunter]', ...args);

const sampleResults = [
  {
    ip: '1.1.1.1',
    port: 443,
    domain: 'example.com',
    url: 'https://example.com',
    web_title: 'Example Domain',
    protocol: 'https',
    status_code: 200,
    os: 'Linux',
    company: 'Example Corp',
    country: 'CN',
    province: 'Beijing',
    city: 'Beijing',
    isp: 'China Telecom',
    as_org: 'AS13335',
    cert_sha256: 'abc123def456',
    component: 'nginx/1.18.0',
    header: 'HTTP/1.1 200 OK\r\nServer: nginx',
    banner: '',
    updated_at: '2026-06-24T00:00:00Z'
  },
  {
    ip: '2.2.2.2',
    port: 80,
    domain: 'test.example.com',
    url: 'http://test.example.com',
    web_title: 'Test Page',
    protocol: 'http',
    status_code: 200,
    os: 'Ubuntu',
    company: '',
    country: 'US',
    province: 'California',
    city: 'San Francisco',
    isp: 'Cloudflare',
    as_org: 'AS13335',
    cert_sha256: '',
    component: 'Apache/2.4.41',
    header: 'HTTP/1.1 200 OK\r\nServer: Apache',
    banner: '',
    updated_at: '2026-06-23T12:00:00Z'
  },
  {
    ip: '3.3.3.3',
    port: 22,
    domain: '',
    url: '',
    web_title: '',
    protocol: 'ssh',
    status_code: 0,
    os: '',
    company: '',
    country: 'JP',
    province: 'Tokyo',
    city: 'Tokyo',
    isp: 'NTT',
    as_org: 'AS4713',
    cert_sha256: '',
    component: '',
    header: '',
    banner: 'SSH-2.0-OpenSSH_8.9p1',
    updated_at: '2026-06-22T08:30:00Z'
  }
];

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url?.startsWith('/openApi/search')) {
    const url = new URL(req.url, 'http://localhost');
    const apiKey = url.searchParams.get('api-key');
    const search = url.searchParams.get('search');
    const page = Number(url.searchParams.get('page') || 1);
    const pageSize = Number(url.searchParams.get('page_size') || 10);

    if (!apiKey) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 401, message: 'missing api-key', data: {} }));
      return;
    }

    if (!search || !search.trim()) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 400, message: 'search query required', data: {} }));
      return;
    }

    // Decode base64url-encoded search query (RFC 4648)
    let decodedSearch = '';
    try {
      decodedSearch = Buffer.from(search.trim(), 'base64url').toString('utf-8');
    } catch {
      // If decode fails, use raw value for backward compatibility
      decodedSearch = search;
    }

    // Simulate search filtering based on decoded query
    let filtered = [...sampleResults];
    const queryLower = decodedSearch.toLowerCase();

    if (queryLower.includes('ip=')) {
      const ipMatch = decodedSearch.match(/ip[!=]?="([^"]+)"/);
      if (ipMatch) {
        const targetIp = ipMatch[1];
        filtered = filtered.filter((r) => {
          if (decodedSearch.includes('!=') || decodedSearch.includes('!==')) {
            return r.ip !== targetIp;
          }
          return decodedSearch.includes('==') ? r.ip === targetIp : r.ip.includes(targetIp);
        });
      }
    }

    if (queryLower.includes('domain=')) {
      const domainMatch = decodedSearch.match(/domain[!=]?="([^"]+)"/);
      if (domainMatch) {
        const targetDomain = domainMatch[1];
        filtered = filtered.filter((r) => {
          if (decodedSearch.includes('!=') || decodedSearch.includes('!==')) {
            return r.domain !== targetDomain;
          }
          return decodedSearch.includes('==') ? r.domain === targetDomain : r.domain.includes(targetDomain);
        });
      }
    }

    if (queryLower.includes('port=')) {
      const portMatch = decodedSearch.match(/port[!=]?="([^"]+)"/);
      if (portMatch) {
        const targetPort = Number(portMatch[1]);
        filtered = filtered.filter((r) => {
          if (decodedSearch.includes('!=') || decodedSearch.includes('!==')) {
            return r.port !== targetPort;
          }
          return r.port === targetPort;
        });
      }
    }

    if (queryLower.includes('country=')) {
      const countryMatch = decodedSearch.match(/country[!=]?="([^"]+)"/);
      if (countryMatch) {
        const targetCountry = countryMatch[1].toUpperCase();
        filtered = filtered.filter((r) => {
          if (decodedSearch.includes('!=') || decodedSearch.includes('!==')) {
            return r.country !== targetCountry;
          }
          return r.country === targetCountry;
        });
      }
    }

    if (queryLower.includes('component=')) {
      const compMatch = decodedSearch.match(/component[!=]?="([^"]+)"/);
      if (compMatch) {
        const targetComp = compMatch[1].toLowerCase();
        filtered = filtered.filter((r) => {
          if (decodedSearch.includes('!=') || decodedSearch.includes('!==')) {
            return !r.component.toLowerCase().includes(targetComp);
          }
          return r.component.toLowerCase().includes(targetComp);
        });
      }
    }

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const paged = filtered.slice(start, start + pageSize);

    const response = {
      code: 200,
      message: 'ok',
      data: {
        list: paged,
        total,
        page,
        page_size: pageSize,
        total_pages: Math.ceil(total / pageSize)
      }
    };

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(response));
    log('search', { search, page, pageSize, returned: paged.length, total });
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

server.listen(httpPort, () =>
  log(`listening on :${httpPort} (GET /openApi/search)`)
);
