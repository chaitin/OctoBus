/* node:coverage disable */
import http from 'node:http';

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

const multipartField = (body, name) => {
  const text = Buffer.isBuffer(body) ? body.toString('latin1') : String(body || '');
  const re = new RegExp(`name="${name}"(?:; filename="([^"]*)")?\\r\\n(?:Content-Type: [^\\r]+\\r\\n)?\\r\\n([\\s\\S]*?)\\r\\n--`);
  const match = re.exec(text);
  if (!match) return null;
  return { filename: match[1] || '', value: match[2] || '' };
};

export const createMockServer = async ({ expectedApiKey = 'test_api_key' } = {}) => {
  const requests = [];

  const sendJson = (res, status, payload) => {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
    });
    res.end(body);
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const body = await readBody(req);
    const query = Object.fromEntries(url.searchParams);
    const requestRecord = {
      method: req.method,
      path: url.pathname,
      query,
      headers: req.headers,
      body,
      multipart: {
        apikey: multipartField(body, 'apikey')?.value,
        sandbox_type: multipartField(body, 'sandbox_type')?.value,
        run_time: multipartField(body, 'run_time')?.value,
        file: multipartField(body, 'file'),
      },
    };
    requests.push(requestRecord);

    const apikey = String(query.apikey || requestRecord.multipart.apikey || '').trim();
    const resource = String(query.resource || '').trim();

    if (!apikey) {
      sendJson(res, 401, { response_code: 1100, verbose_msg: 'apikey required' });
      return;
    }
    if (apikey !== expectedApiKey) {
      sendJson(res, 403, { response_code: 1101, verbose_msg: 'invalid apikey' });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v3/file/upload') {
      if (!requestRecord.multipart.file?.value) {
        sendJson(res, 200, { response_code: 1200, verbose_msg: 'file required' });
        return;
      }
      sendJson(res, 200, {
        verbose_msg: 'OK',
        response_code: 0,
        data: {
          sha256: 'a'.repeat(64),
          permalink: 'https://s.threatbook.com/report/file/example',
        },
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v3/file/report') {
      if (!resource) {
        sendJson(res, 200, { response_code: 1200, verbose_msg: 'resource required' });
        return;
      }
      sendJson(res, 200, {
        response_code: 0,
        verbose_msg: 'OK',
        data: {
          summary: {
            threat_level: 'malicious',
            malware_type: 'Trojan',
            malware_family: 'CobaltStrike',
            is_whitelist: false,
            submit_time: '2019-01-22 17:36:21',
            file_name: 'sample.bin',
            file_type: 'EXEx86',
            sample_sha256: resource,
            md5: 'b'.repeat(32),
            sha1: 'c'.repeat(40),
            scenes: ['Cybercrime'],
            threat_score: 60,
            sandbox_type: query.sandbox_type || 'win7_sp1_enx86_office2013',
            sandbox_type_list: ['win7_sp1_enx86_office2013'],
            multi_engines: '7/22',
          },
          multiengines: {
            result: {
              Kaspersky: 'Trojan',
              Microsoft: 'safe',
            },
            scan_time: '2019-10-22 16:17:48',
          },
          permalink: 'https://s.threatbook.com/report/file/example',
        },
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v3/file/report/multiengines') {
      if (!resource) {
        sendJson(res, 200, { response_code: 1200, verbose_msg: 'resource required' });
        return;
      }
      sendJson(res, 200, {
        response_code: 0,
        verbose_msg: 'OK',
        data: {
          multiengines: {
            threat_level: 'malicious',
            total: 22,
            scans: {
              Kaspersky: 'safe',
              Microsoft: 'DoS:Linux/Xorddos!rfn',
            },
            is_white: false,
            total2: 22,
            positives: 9,
            scan_date: '2019-01-22 13:23:55',
            malware_type: 'DoS',
            malware_family: 'Xorddos',
          },
        },
      });
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    requests,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
};
