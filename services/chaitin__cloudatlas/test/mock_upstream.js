// Mock upstream for Chaitin CloudAtlas OpenAPI
import http from 'node:http';

const port = Number(process.env.HTTP_PORT || 18083);
const log = (...args) => console.log('[mock-cloudatlas]', ...args);

// ── Helpers ──────────────────────────────────────────────────────────

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString();
    try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
  });
  req.on('error', reject);
});

const sendJSON = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
};

const successList = (items, total) => ({ code: 200, data: { items, total } });
const successMutation = (affectedCount, message = '') => ({ affected_count: affectedCount, message });

// ── In-memory stores ─────────────────────────────────────────────────

const stores = {};
const storeKeys = [
  'enterprise', 'keyword', 'domain', 'cert', 'icon', 'web-title',
  'root-domain', 'subdomain', 'dns', 'ip', 'asset-cert',
  'port', 'openport', 'web', 'dir', 'appfinger', 'crawler',
  'high-risk', 'product', 'service',
  'vendor', 'subject', 'vuln',
  'rule', 'github', 'disk', 'doc', 'darknet', 'stealer-log', 'email', 'app', 'media',
  'schedule', 'session',
  'space', 'tag', 'bu',
];
for (const key of storeKeys) stores[key] = new Map();

let autoId = 1;
const nextId = () => autoId++;

// Seed sample data
stores.enterprise.set(1, { id: 1, name: 'test-enterprise', enable: true, confidence: 'high', space: 1 });
stores.keyword.set(1, { id: 1, name: 'test-keyword', type: 'domain', enable: true, confidence: 'medium', space: 1 });
stores.domain.set(1, { id: 1, name: 'example.com', enable: true, confidence: 'low', space: 1 });
stores.cert.set(1, { id: 1, name: 'test-cert', space: 1 });
stores.icon.set(1, { id: 1, name: 'test-icon', space: 1 });
stores['web-title'].set(1, { id: 1, name: 'test-web-title', space: 1 });
stores['root-domain'].set(1, { id: 1, name: 'example.com', space: 1 });
stores.subdomain.set(1, { id: 1, hostname: 'sub.example.com', space: 1 });
stores.dns.set(1, { id: 1, hostname: 'sub.example.com', view_mode: 'detail', space: 1 });
stores.ip.set(1, { id: 1, address: '1.2.3.4', hostname: 'h', space: 1 });
stores['asset-cert'].set(1, { id: 1, name: 'asset-cert', space: 1 });
stores.port.set(1, { id: 1, ip: '1.2.3.4', port: 80, hostname: 'h', space: 1 });
stores.openport.set(1, { id: 1, ip: '1.2.3.4', space: 1 });
stores.web.set(1, { id: 1, url: 'http://example.com', hostname: 'example.com', space: 1 });
stores.dir.set(1, { id: 1, url: 'http://example.com', space: 1 });
stores.appfinger.set(1, { id: 1, name: 'nginx', space: 1 });
stores.crawler.set(1, { id: 1, url: 'http://example.com', space: 1 });
stores['high-risk'].set(1, { id: 1, hostname: 'example.com', status: 'unconfirmed', space: 1 });
stores.product.set(5, { id: 5, name: 'nginx' });
stores.service.set(1, { id: 1, name: 'ssh', space: 1 });
stores.vendor.set(1, { id: 1, name: 'vendor-a', space: 1 });
stores.subject.set(1, { id: 1, name: 'subject-a', space: 1 });
stores.vuln.set(7, { id: 7, name: 'CVE-2024-0001', space: 1 });
stores.rule.set(3, { id: 3, name: 'monitor-rule-1', space: 1 });
stores.github.set(1, { id: 1, name: 'github-leak', space: 1 });
stores.disk.set(1, { id: 1, name: 'disk-leak', space: 1 });
stores.doc.set(1, { id: 1, name: 'doc-leak', space: 1 });
stores.darknet.set(1, { id: 1, name: 'darknet-intel', space: 1 });
stores['stealer-log'].set(1, { id: 1, name: 'stolen-data', space: 1 });
stores.email.set(1, { id: 1, name: 'email-leak', space: 1 });
stores.app.set(1, { id: 1, name: 'mobile-app', space: 1 });
stores.media.set(1, { id: 1, name: 'social-media', space: 1 });
stores.schedule.set(1, { id: 1, name: 'test-schedule', task_type: 'scan', space: 1 });
stores.session.set(1, { id: 1, name: 'test-session', task_type: 'scan' });
stores.space.set(1, { id: 1, name: 'default-space' });
stores.tag.set(1, { id: 1, name: 'test-tag' });
stores.bu.set(1, { id: 1, name: 'test-bu' });

// ── Helpers: filtering & pagination ──────────────────────────────────

const filterAndPaginate = (items, url) => {
  let filtered = items;
  const space = url.searchParams.get('space');
  if (space) filtered = filtered.filter((i) => String(i.space) === space);

  const name = url.searchParams.get('name');
  if (name) filtered = filtered.filter((i) => i.name?.includes(name));

  const hostname = url.searchParams.get('hostname');
  if (hostname) filtered = filtered.filter((i) => i.hostname?.includes(hostname));

  const ip = url.searchParams.get('ip');
  if (ip) filtered = filtered.filter((i) => i.ip === ip || i.address === ip);

  const type = url.searchParams.get('type');
  if (type) filtered = filtered.filter((i) => i.type === type);

  const page = Number(url.searchParams.get('page') || 1);
  const size = Number(url.searchParams.get('size') || 20);
  const total = filtered.length;
  const start = (page - 1) * size;
  return { items: filtered.slice(start, start + size), total };
};

// ── Route matching ───────────────────────────────────────────────────

export const createMockServer = () => http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const path = url.pathname;
  const method = req.method;
  const token = req.headers['token'] || '';

  // Auth: require TOKEN header
  if (!token) {
    sendJSON(res, 401, { message: 'missing token' });
    return;
  }

  // ── Seed list (GET /openapi/v1/seed/{type}) ──────────────────────
  const seedListMatch = path.match(/^\/openapi\/v1\/seed\/([\w-]+)$/);
  if (method === 'GET' && seedListMatch) {
    const storeKey = seedListMatch[1];
    if (stores[storeKey]) {
      const all = Array.from(stores[storeKey].values());
      const result = filterAndPaginate(all, url);
      sendJSON(res, 200, successList(result.items, result.total));
      return;
    }
  }

  // ── Seed batch-create (POST /openapi/v1/seed/{type}/batch-create) ──
  const seedBatchCreateMatch = path.match(/^\/openapi\/v1\/seed\/([\w-]+)\/batch-create$/);
  if (method === 'POST' && seedBatchCreateMatch) {
    const storeKey = seedBatchCreateMatch[1];
    const body = await readBody(req);
    const entries = Array.isArray(body.entries) ? body.entries : [];
    const count = entries.length;
    entries.forEach((entry) => {
      const id = nextId();
      stores[storeKey].set(id, { id, ...entry, space: body.space ?? entry.space ?? 1 });
    });
    sendJSON(res, 200, successMutation(count));
    return;
  }

  // ── Seed switch (POST /openapi/v1/seed/{type}/switch) ────────────
  const seedSwitchMatch = path.match(/^\/openapi\/v1\/seed\/([\w-]+)\/switch$/);
  if (method === 'POST' && seedSwitchMatch) {
    const storeKey = seedSwitchMatch[1];
    const body = await readBody(req);
    const ids = Array.isArray(body.ids) ? body.ids : [];
    ids.forEach((id) => {
      const item = stores[storeKey].get(Number(id));
      if (item) stores[storeKey].set(Number(id), { ...item, enable: body.enable });
    });
    sendJSON(res, 200, successMutation(ids.length));
    return;
  }

  // ── Seed update-confidence (POST /openapi/v1/seed/{type}/update-confidence) ──
  const seedConfMatch = path.match(/^\/openapi\/v1\/seed\/([\w-]+)\/update-confidence$/);
  if (method === 'POST' && seedConfMatch) {
    const storeKey = seedConfMatch[1];
    const body = await readBody(req);
    const ids = Array.isArray(body.ids) ? body.ids : [];
    ids.forEach((id) => {
      const item = stores[storeKey].get(Number(id));
      if (item) stores[storeKey].set(Number(id), { ...item, confidence: body.confidence });
    });
    sendJSON(res, 200, successMutation(ids.length));
    return;
  }

  // ── Seed batch-delete (DELETE /openapi/v1/seed/{type}/batch-delete) ──
  const seedBatchDeleteMatch = path.match(/^\/openapi\/v1\/seed\/([\w-]+)\/batch-delete$/);
  if (method === 'DELETE' && seedBatchDeleteMatch) {
    const storeKey = seedBatchDeleteMatch[1];
    const body = await readBody(req);
    const ids = Array.isArray(body.ids) ? body.ids : [];
    let deleted = 0;
    ids.forEach((id) => { if (stores[storeKey].delete(Number(id))) deleted++; });
    sendJSON(res, 200, successMutation(deleted));
    return;
  }

  // ── Asset list (GET /openapi/v1/asset/{type}) ────────────────────
  const assetListMatch = path.match(/^\/openapi\/v1\/asset\/([\w-]+)$/);
  if (method === 'GET' && assetListMatch) {
    const storeKey = assetListMatch[1];
    if (stores[storeKey]) {
      const all = Array.from(stores[storeKey].values());
      const result = filterAndPaginate(all, url);
      sendJSON(res, 200, successList(result.items, result.total));
      return;
    }
  }

  // ── Asset batch-create (POST /openapi/v1/asset/{type}/batch-create) ──
  const assetBatchCreateMatch = path.match(/^\/openapi\/v1\/asset\/([\w-]+)\/batch-create$/);
  if (method === 'POST' && assetBatchCreateMatch) {
    const storeKey = assetBatchCreateMatch[1];
    const body = await readBody(req);
    const entries = Array.isArray(body.entries) ? body.entries : [];
    const count = entries.length;
    entries.forEach((entry) => {
      const id = nextId();
      stores[storeKey].set(id, { id, ...entry, space: body.space ?? entry.space ?? 1 });
    });
    sendJSON(res, 200, successMutation(count));
    return;
  }

  // ── Asset status update (POST /openapi/v1/asset/{type}/status) ───
  const assetStatusMatch = path.match(/^\/openapi\/v1\/asset\/([\w-]+)\/status$/);
  if (method === 'POST' && assetStatusMatch) {
    const storeKey = assetStatusMatch[1];
    const body = await readBody(req);
    const ids = Array.isArray(body.ids) ? body.ids : [];
    ids.forEach((id) => {
      const item = stores[storeKey].get(Number(id));
      if (item) stores[storeKey].set(Number(id), { ...item, status: body.status });
    });
    sendJSON(res, 200, successMutation(ids.length));
    return;
  }

  // ── Asset batch-delete (DELETE /openapi/v1/asset/{type}/batch-delete) ──
  const assetBatchDeleteMatch = path.match(/^\/openapi\/v1\/asset\/([\w-]+)\/batch-delete$/);
  if (method === 'DELETE' && assetBatchDeleteMatch) {
    const storeKey = assetBatchDeleteMatch[1];
    const body = await readBody(req);
    const ids = Array.isArray(body.ids) ? body.ids : [];
    let deleted = 0;
    ids.forEach((id) => { if (stores[storeKey].delete(Number(id))) deleted++; });
    sendJSON(res, 200, successMutation(deleted));
    return;
  }

  // ── Attack list (GET /openapi/v1/attack/{type}) ──────────────────
  const attackListMatch = path.match(/^\/openapi\/v1\/attack\/([\w-]+)$/);
  if (method === 'GET' && attackListMatch) {
    const storeKey = attackListMatch[1];
    if (stores[storeKey]) {
      const all = Array.from(stores[storeKey].values());
      const result = filterAndPaginate(all, url);
      sendJSON(res, 200, successList(result.items, result.total));
      return;
    }
  }

  // ── Risk list (GET /openapi/v1/risk/{type}) ─────────────────────
  const riskListMatch = path.match(/^\/openapi\/v1\/risk\/([\w-]+)$/);
  if (method === 'GET' && riskListMatch) {
    const storeKey = riskListMatch[1];
    if (stores[storeKey]) {
      const all = Array.from(stores[storeKey].values());
      const result = filterAndPaginate(all, url);
      sendJSON(res, 200, successList(result.items, result.total));
      return;
    }
  }

  // ── Risk: product/{pk}/finger (GET) ─────────────────────────────
  const riskProductFingerMatch = path.match(/^\/openapi\/v1\/risk\/product\/(\d+)\/finger$/);
  if (method === 'GET' && riskProductFingerMatch) {
    const pk = Number(riskProductFingerMatch[1]);
    sendJSON(res, 200, { id: pk, name: 'app', fingers: [{ name: 'finger1' }] });
    return;
  }

  // ── Risk: high-risk/status (POST) ────────────────────────────────
  if (method === 'POST' && path === '/openapi/v1/risk/high-risk/status') {
    const body = await readBody(req);
    const ids = Array.isArray(body.ids) ? body.ids : [];
    ids.forEach((id) => {
      const item = stores['high-risk'].get(Number(id));
      if (item) stores['high-risk'].set(Number(id), { ...item, status: body.status });
    });
    sendJSON(res, 200, successMutation(ids.length));
    return;
  }

  // ── Risk: high-risk/recheck (POST) ──────────────────────────────
  if (method === 'POST' && path === '/openapi/v1/risk/high-risk/recheck') {
    const body = await readBody(req);
    const ids = Array.isArray(body.ids) ? body.ids : [];
    sendJSON(res, 200, successMutation(ids.length));
    return;
  }

  // ── KB list (GET /openapi/v1/kb/{type}) ──────────────────────────
  const kbListMatch = path.match(/^\/openapi\/v1\/kb\/([\w-]+)$/);
  if (method === 'GET' && kbListMatch) {
    const storeKey = kbListMatch[1];
    if (stores[storeKey]) {
      const all = Array.from(stores[storeKey].values());
      const result = filterAndPaginate(all, url);
      sendJSON(res, 200, successList(result.items, result.total));
      return;
    }
  }

  // ── KB: product/{pk} (GET) ──────────────────────────────────────
  const kbProductMatch = path.match(/^\/openapi\/v1\/kb\/product\/(\d+)$/);
  if (method === 'GET' && kbProductMatch) {
    const pk = Number(kbProductMatch[1]);
    const item = stores.product.get(pk);
    if (item) sendJSON(res, 200, item);
    else sendJSON(res, 200, { id: pk, name: 'product-' + pk });
    return;
  }

  // ── KB: vuln/{pk}/product (GET) ─────────────────────────────────
  const kbVulnProductMatch = path.match(/^\/openapi\/v1\/kb\/vuln\/(\d+)\/product$/);
  if (method === 'GET' && kbVulnProductMatch) {
    const pk = Number(kbVulnProductMatch[1]);
    sendJSON(res, 200, successList([{ id: pk, name: 'vuln-product' }], 1));
    return;
  }

  // ── DRPS list (GET /openapi/v1/drps/{type}) ──────────────────────
  const drpsListMatch = path.match(/^\/openapi\/v1\/drps\/([\w-]+)$/);
  if (method === 'GET' && drpsListMatch) {
    const storeKey = drpsListMatch[1];
    if (stores[storeKey]) {
      const all = Array.from(stores[storeKey].values());
      const result = filterAndPaginate(all, url);
      sendJSON(res, 200, successList(result.items, result.total));
      return;
    }
  }

  // ── DRPS: rule/{pk} (GET) ───────────────────────────────────────
  const drpsRuleMatch = path.match(/^\/openapi\/v1\/drps\/rule\/(\d+)$/);
  if (method === 'GET' && drpsRuleMatch) {
    const pk = Number(drpsRuleMatch[1]);
    const item = stores.rule.get(pk);
    if (item) sendJSON(res, 200, item);
    else sendJSON(res, 200, { id: pk, name: 'rule-' + pk });
    return;
  }

  // ── DRPS: rule/batch-create (POST) ──────────────────────────────
  if (method === 'POST' && path === '/openapi/v1/drps/rule/batch-create') {
    const body = await readBody(req);
    const entries = Array.isArray(body.entries) ? body.entries : [];
    const count = entries.length;
    entries.forEach((entry) => {
      const id = nextId();
      stores.rule.set(id, { id, ...entry, space: body.space ?? entry.space ?? 1 });
    });
    sendJSON(res, 200, successMutation(count));
    return;
  }

  // ── Task: schedule list (GET /openapi/v1/task/schedule) ──────────
  if (method === 'GET' && path === '/openapi/v1/task/schedule') {
    const all = Array.from(stores.schedule.values());
    const result = filterAndPaginate(all, url);
    sendJSON(res, 200, successList(result.items, result.total));
    return;
  }

  // ── Task: schedule/{pk} (GET) ────────────────────────────────────
  const scheduleMatch = path.match(/^\/openapi\/v1\/task\/schedule\/(\d+)$/);
  if (method === 'GET' && scheduleMatch) {
    const pk = Number(scheduleMatch[1]);
    const item = stores.schedule.get(pk);
    if (item) sendJSON(res, 200, item);
    else sendJSON(res, 200, { id: pk, name: 'schedule-' + pk });
    return;
  }

  // ── Task: create schedule (POST /openapi/v1/task/schedule) ───────
  if (method === 'POST' && path === '/openapi/v1/task/schedule') {
    const body = await readBody(req);
    const id = nextId();
    stores.schedule.set(id, { id, name: body.name, task_type: body.task_type, cron: body.cron, space: body.space });
    sendJSON(res, 200, { id });
    return;
  }

  // ── Task: run-immediately (POST /openapi/v1/task/schedule/{pk}/run-immediately) ──
  const runImmediatelyMatch = path.match(/^\/openapi\/v1\/task\/schedule\/(\d+)\/run-immediately$/);
  if (method === 'POST' && runImmediatelyMatch) {
    sendJSON(res, 200, { code: 200 });
    return;
  }

  // ── Task: session list (GET /openapi/v1/task/session) ────────────
  if (method === 'GET' && path === '/openapi/v1/task/session') {
    const all = Array.from(stores.session.values());
    const result = filterAndPaginate(all, url);
    sendJSON(res, 200, successList(result.items, result.total));
    return;
  }

  // ── Task: session/{pk} (GET) ─────────────────────────────────────
  const sessionMatch = path.match(/^\/openapi\/v1\/task\/session\/(\d+)$/);
  if (method === 'GET' && sessionMatch) {
    const pk = Number(sessionMatch[1]);
    const item = stores.session.get(pk);
    if (item) sendJSON(res, 200, item);
    else sendJSON(res, 200, { id: pk, name: 'session-' + pk });
    return;
  }

  // ── Task: create session (POST /openapi/v1/task/session) ─────────
  if (method === 'POST' && path === '/openapi/v1/task/session') {
    const body = await readBody(req);
    const id = nextId();
    stores.session.set(id, { id, name: body.name, task_type: body.task_type });
    sendJSON(res, 200, { id });
    return;
  }

  // ── Space: space list (GET /openapi/v1/space/space) ──────────────
  if (method === 'GET' && path === '/openapi/v1/space/space') {
    const all = Array.from(stores.space.values());
    const result = filterAndPaginate(all, url);
    sendJSON(res, 200, successList(result.items, result.total));
    return;
  }

  // ── Space: space/{pk} (GET) ──────────────────────────────────────
  const spaceMatch = path.match(/^\/openapi\/v1\/space\/space\/(\d+)$/);
  if (method === 'GET' && spaceMatch) {
    const pk = Number(spaceMatch[1]);
    const item = stores.space.get(pk);
    if (item) sendJSON(res, 200, item);
    else sendJSON(res, 200, { id: pk, name: 'space-' + pk });
    return;
  }

  // ── Space: tag list (GET /openapi/v1/space/tag) ──────────────────
  if (method === 'GET' && path === '/openapi/v1/space/tag') {
    const all = Array.from(stores.tag.values());
    const result = filterAndPaginate(all, url);
    sendJSON(res, 200, successList(result.items, result.total));
    return;
  }

  // ── Space: tag/options (GET) ──────────────────────────────────────
  if (method === 'GET' && path === '/openapi/v1/space/tag/options') {
    const all = Array.from(stores.tag.values());
    sendJSON(res, 200, successList(all, all.length));
    return;
  }

  // ── Space: bu list (GET /openapi/v1/space/bu) ────────────────────
  if (method === 'GET' && path === '/openapi/v1/space/bu') {
    const all = Array.from(stores.bu.values());
    const result = filterAndPaginate(all, url);
    sendJSON(res, 200, successList(result.items, result.total));
    return;
  }

  // ── Space: bu/options (GET) ──────────────────────────────────────
  if (method === 'GET' && path === '/openapi/v1/space/bu/options') {
    const all = Array.from(stores.bu.values());
    sendJSON(res, 200, successList(all, all.length));
    return;
  }

  // ── Fallback ──────────────────────────────────────────────────────
  sendJSON(res, 404, { code: 404, message: 'not found' });
});

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  createMockServer().listen(port, '0.0.0.0', () => {
    log(`listening on :${port} — CloudAtlas OpenAPI v1 mock`);
  });
}
