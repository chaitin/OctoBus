/* node:coverage disable */
import http from 'node:http';

export const DEFAULT_USER = 'elastic';
export const DEFAULT_PASSWORD = 'changeme';

const readJsonBody = (req) => new Promise((resolve, reject) => {
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 2 * 1024 * 1024) req.destroy(new Error('payload too large'));
  });
  req.on('end', () => {
    if (!raw.trim()) { resolve({}); return; }
    try { resolve(JSON.parse(raw)); } catch (err) { reject(err); }
  });
  req.on('error', reject);
});

const parseBasicAuth = (header) => {
  if (!header || typeof header !== 'string' || !header.startsWith('Basic ')) return null;
  try {
    const value = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
    const idx = value.indexOf(':');
    return idx === -1 ? { user: value, password: '' } : { user: value.slice(0, idx), password: value.slice(idx + 1) };
  } catch { return null; }
};

const sendJson = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
};

export function createMockServer({ expectedUser = DEFAULT_USER, expectedPassword = DEFAULT_PASSWORD } = {}) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const fullUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const path = fullUrl.pathname;
    const entry = {
      method: req.method, path,
      query: Object.fromEntries(fullUrl.searchParams),
      headers: req.headers,
    };
    const readBody = async () => {
      if (req.method === 'GET' || req.method === 'HEAD') return {};
      return readJsonBody(req);
    };
    const body = await readBody().catch(() => ({}));
    entry.body = body;
    requests.push(entry);

    const auth = parseBasicAuth(req.headers.authorization);
    const wantAuth = !(path === '/' && req.method === 'GET');
    if (wantAuth) {
      if (!auth) { sendJson(res, 401, { error: { type: 'security_exception', reason: 'missing authentication' } }); return; }
      if (expectedUser && auth.user !== expectedUser) { sendJson(res, 403, { error: { type: 'security_exception', reason: 'unknown user' } }); return; }
      if (expectedPassword && auth.password !== expectedPassword) { sendJson(res, 403, { error: { type: 'security_exception', reason: 'bad password' } }); return; }
    }

    if (req.method === 'GET' && path === '/_cluster/health') {
      const level = String(fullUrl.searchParams.get('level') || '').toLowerCase();
      if (level && !['cluster', 'indices', 'shards'].includes(level)) {
        sendJson(res, 400, { error: { type: 'illegal_argument_exception', reason: 'invalid level' } }); return;
      }
      sendJson(res, 200, {
        cluster_name: 'mock-cluster', status: 'green', timed_out: false,
        number_of_nodes: 3, number_of_data_nodes: 3,
        active_primary_shards: 10, active_shards: 20,
        relocating_shards: 0, initializing_shards: 0,
        unassigned_shards: 0, delayed_unassigned_shards: 0,
        number_of_pending_tasks: 0, number_of_in_flight_fetch: 0,
        task_max_waiting_in_queue_millis: 0,
        active_shards_percent_as_number: 100.0,
      });
      return;
    }

    // Cat nodes (MUST precede _cat/* wildcard)
    if (req.method === 'GET' && path === '/_cat/nodes') {
      sendJson(res, 200, [
        { ip: '10.0.0.1', name: 'node-1', 'heap.percent': '30', 'ram.percent': '60', cpu: '5', load_1m: '0.10', load_5m: '0.20', load_15m: '0.30', 'node.role': 'mdi', master: '*' },
        { ip: '10.0.0.2', name: 'node-2', 'heap.percent': '40', 'ram.percent': '65', cpu: '7', load_1m: '0.11', load_5m: '0.21', load_15m: '0.31', 'node.role': 'di', master: '-' },
      ]);
      return;
    }

    if (req.method === 'GET' && (path === '/_cat/indices' || path.startsWith('/_cat/'))) {
      sendJson(res, 200, [
        { health: 'green', status: 'open', index: 'logs-2026.01', uuid: 'uuid-logs', pri: '1', rep: '1', 'docs.count': '100', 'docs.deleted': '0', 'store.size': '1kb', 'pri.store.size': '512b' },
        { health: 'yellow', status: 'open', index: 'metrics', uuid: 'uuid-metrics', pri: '1', rep: '1', 'docs.count': '42', 'docs.deleted': '5', 'store.size': '2kb', 'pri.store.size': '1kb' },
      ]);
      return;
    }

    if (req.method === 'GET' && path.startsWith('/') && !path.startsWith('/_') && !path.includes('/_')) {
      const idx = decodeURIComponent(path.slice(1));
      if (idx === 'missing') {
        sendJson(res, 404, { error: { type: 'index_not_found_exception', reason: `no such index [${idx}]` } });
        return;
      }
      sendJson(res, 200, {
        [idx]: {
          aliases: {
            'alias-write': { is_write_index: true, is_hidden: false },
            'alias-search': { is_write_index: false, is_hidden: false, search_routing: '1' },
          },
          mappings: {
            dynamic: 'true',
            dynamic_templates: [{ strings_match_keyword: { match_mapping_type: 'string', mapping: { type: 'keyword' } } }],
            properties: {
              message: { type: 'text', analyzer: 'standard' },
              timestamp: { type: 'date', format: 'strict_date_optional_time' },
              level: { type: 'keyword' },
              count: { type: 'long' },
            },
          },
          settings: {
            index: { number_of_shards: '1', number_of_replicas: '1', refresh_interval: '1s' },
          },
        },
      });
      return;
    }

    const searchMatch = req.method === 'POST' && path.match(/^\/(.+)\/_search$/);
    if (searchMatch) {
      const idx = decodeURIComponent(searchMatch[1]);
      if (idx === 'missing') {
        sendJson(res, 404, { error: { type: 'index_not_found_exception', reason: `no such index [${idx}]` } });
        return;
      }
      sendJson(res, 200, {
        took: 5, timed_out: false,
        _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
        _scroll_id: 'DXF1ZXJ5QW5kRmV0Y2gBAAAAAAAAAD4WYm9laVctajdkbW5UdmVYU2VlS2dzS0w=',
        hits: {
          total: { value: 2, relation: 'eq' },
          max_score: 1.0,
          hits: [
            { _index: idx, _id: '1', _score: 1.0, _type: '_doc', _version: 1, _seq_no: 0, _primary_term: 1,
              _source: { message: 'hello' },
              sort: [{ timestamp: '2026-01-01' }],
              highlight: { message: ['<em>hello</em>'] },
              matched_queries: ['match_msg'],
            },
            { _index: idx, _id: '2', _score: 0.9, _type: '_doc', _version: 1, _seq_no: 1, _primary_term: 1,
              _source: { message: 'world' },
              _ignored: ['level.keyword'],
            },
          ],
        },
      });
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { type: 'not_found', reason: 'no handler' } }));
  });

  return {
    requests,
    async start() {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const addr = server.address();
      return `http://${addr.address}:${addr.port}`;
    },
    async close() {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
}