// Mock upstream for the m01 mail gateway threat-intelligence API.
// For manual/integration runs: HTTP_PORT=18100 node test/mock_upstream.js
import http from 'node:http';

const httpPort = Number(process.env.HTTP_PORT || 18100);
const log = (...args) => console.log('[mock-m01]', ...args);

let nextId = 1;
const store = new Map(); // id -> record

const ok = (res, data, msg = 'ok') => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ code: 200, msg, data }));
};
const bad = (res, code, msg) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ code, msg, data: null }));
};

const readBody = (req) => new Promise((resolve) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString();
    resolve(raw ? JSON.parse(raw) : undefined);
  });
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  if (!req.headers['x-api-key'] && !req.headers['authorization']) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 401, msg: 'missing auth', data: null }));
    return;
  }

  if (path === '/m01/intelligence/detection' && req.method === 'POST') {
    const body = await readBody(req);
    if (!Array.isArray(body)) return bad(res, 400, 'body must be an array');
    const data = body.map((q) => {
      const hitRec = Array.from(store.values()).find((r) => r.pattern === q.pattern);
      return {
        hit: Boolean(hitRec), request_id: q.request_id, id: hitRec?.id || '', description: hitRec?.description || '',
        source_industry: [], source: 'local', status: hitRec?.status || 'active', tlp: hitRec?.tlp || 'AMBER',
        intelligence_type: '钓鱼欺诈', urgency: hitRec?.urgency || 'medium',
        first_discovered_time: '', last_active_time: '', intelligence_update_time: '', intelligence_expiration_time: '',
        attribute: q.type, pattern: q.pattern, info: { matched: Boolean(hitRec) }, phishing_script: [],
      };
    });
    return ok(res, data);
  }

  if (path === '/m01/intelligence/list' && req.method === 'POST') {
    const body = (await readBody(req)) || {};
    let records = Array.from(store.values());
    if (body.pattern) records = records.filter((r) => r.pattern.includes(body.pattern));
    if (body.status) records = records.filter((r) => r.status === body.status);
    const page = body.page || 1;
    const pageSize = body.page_size || 10;
    const start = (page - 1) * pageSize;
    return ok(res, {
      total: records.length, page, page_size: pageSize,
      total_pages: Math.max(1, Math.ceil(records.length / pageSize)),
      records: records.slice(start, start + pageSize),
    });
  }

  if (path === '/m01/intelligence/add' && req.method === 'POST') {
    const body = await readBody(req);
    if (!Array.isArray(body)) return bad(res, 400, 'body must be an array');
    const ids = []; const failures = [];
    for (const it of body) {
      const dup = Array.from(store.values()).find((r) => r.pattern === it.pattern);
      if (dup) { failures.push({ pattern: it.pattern, reason: 'already exists' }); continue; }
      const id = `int-${nextId++}`;
      store.set(id, { id, pattern: it.pattern, status: it.status || 'active', tlp: it.tlp, urgency: it.urgency, attribute: it.attribute, description: it.description || '' });
      ids.push({ intelligence_id: id, pattern: it.pattern });
    }
    return ok(res, { success_count: ids.length, intelligence_ids: ids, failed_count: failures.length, failures });
  }

  if (path === '/m01/intelligence/update' && req.method === 'POST') {
    const body = await readBody(req);
    if (!Array.isArray(body) || !body.length) return bad(res, 400, 'body must be a non-empty array');
    let lastId = '';
    for (const it of body) {
      const rec = store.get(it.id);
      if (rec) {
        if (it.status !== undefined) rec.status = it.status;
        if (it.urgency !== undefined) rec.urgency = it.urgency;
        if (it.tlp !== undefined) rec.tlp = it.tlp;
        if (it.description !== undefined) rec.description = it.description;
      }
      lastId = it.id;
    }
    return ok(res, lastId);
  }

  if (path === '/m01/intelligence/delete' && req.method === 'POST') {
    const body = await readBody(req);
    if (!Array.isArray(body)) return bad(res, 400, 'body must be an array');
    let count = 0;
    for (const it of body) { if (store.delete(it.intelligence_id)) count += 1; }
    return ok(res, { success_count: count });
  }

  if (path === '/m01/intelligence/stats' && req.method === 'GET') {
    const all = Array.from(store.values());
    return ok(res, {
      total: all.length,
      active_count: all.filter((r) => r.status === 'active').length,
      revoked_count: all.filter((r) => r.status === 'revoked').length,
    });
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ code: 404, msg: 'not found', data: null }));
});

server.listen(httpPort, () => log(`listening on :${httpPort}`));
