// Mock upstream for Cortex API
import http from 'node:http';

const httpPort = Number(process.env.HTTP_PORT || 18080);
const log = (...args) => console.log('[mock-cortex]', ...args);

const sampleAnalyzers = [
  {
    id: 'VirusTotal_3_0_sample1',
    name: 'VirusTotal_3_0',
    analyzerDefinitionId: 'VirusTotal_3_0',
    workerDefinitionId: 'VirusTotal_3_0',
    description: 'VirusTotal analysis using API v3',
    dataTypeList: ['ip', 'domain', 'url', 'hash', 'filename', 'mail'],
    version: '3.0',
    tlp: 2,
    state: 'Enabled',
  },
  {
    id: 'Shodan_1_0_sample1',
    name: 'Shodan_1_0',
    analyzerDefinitionId: 'Shodan_1_0',
    workerDefinitionId: 'Shodan_1_0',
    description: 'Shodan IP lookup',
    dataTypeList: ['ip'],
    version: '1.0',
    tlp: 2,
    state: 'Enabled',
  },
  {
    id: 'PassiveTotal_DNS_2_0_sample1',
    name: 'PassiveTotal_DNS_2_0',
    analyzerDefinitionId: 'PassiveTotal_DNS_2_0',
    workerDefinitionId: 'PassiveTotal_DNS_2_0',
    description: 'PassiveTotal DNS resolution',
    dataTypeList: ['domain', 'fqdn'],
    version: '2.0',
    tlp: 2,
    state: 'Enabled',
  },
];

let nextJobId = 1;

const sampleJob = (id, status, dataType, data, analyzerName) => ({
  id: String(id),
  _id: String(id),
  _type: 'job',
  analyzerId: `${analyzerName}_sample1`,
  workerId: `${analyzerName}_sample1`,
  analyzerName,
  workerName: analyzerName,
  analyzerDefinitionId: analyzerName,
  workerDefinitionId: analyzerName,
  status,
  dataType,
  data,
  message: '',
  tlp: 2,
  date: '2024-01-15T10:30:00Z',
  createdAt: 1705312200000,
  startDate: status === 'Success' ? 1705312210000 : undefined,
  endDate: status === 'Success' ? 1705312250000 : undefined,
});

const sampleJobs = [
  sampleJob(1, 'Success', 'ip', '8.8.8.8', 'VirusTotal_3_0'),
  sampleJob(2, 'InProgress', 'domain', 'example.com', 'PassiveTotal_DNS_2_0'),
  sampleJob(3, 'Failure', 'ip', '1.2.3.4', 'Shodan_1_0'),
];

const sampleReport = {
  id: '1',
  _id: '1',
  status: 'Success',
  report: {
    success: true,
    summary: {
      taxonomies: [
        { level: 'info', namespace: 'VirusTotal', value: '8.8.8.8 - 0/73', predicate: 'Score' },
      ],
    },
    full: {
      results: {
        positive: 0,
        total: 73,
        permalink: 'https://www.virustotal.com/gui/ip-address/8.8.8.8',
      },
    },
    operations: [],
    artifacts: [
      {
        data: 'google-public-dns-a.google.com',
        dataType: 'domain',
        message: 'Resolved domain',
        tags: ['resolved'],
        tlp: 2,
      },
    ],
    errorMessage: '',
  },
};

const checkAuth = (req) => {
  const auth = req.headers['authorization'] || '';
  if (!auth) return false;
  // Accept Bearer token or Basic auth
  if (auth.startsWith('Bearer ')) return auth !== 'Bearer ';
  if (auth.startsWith('Basic ')) return true;
  return false;
};

const server = http.createServer((req, res) => {
  if (!checkAuth(req)) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'AuthenticationRequired', message: 'Authentication required' }));
    return;
  }

  // GET /api/analyzer
  if (req.method === 'GET' && req.url === '/api/analyzer') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(sampleAnalyzers));
    return;
  }

  // GET /api/analyzer/type/:dataType
  if (req.method === 'GET' && req.url?.startsWith('/api/analyzer/type/')) {
    const dataType = req.url.replace('/api/analyzer/type/', '');
    const filtered = sampleAnalyzers.filter((a) => a.dataTypeList.includes(dataType));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(filtered));
    return;
  }

  // POST /api/analyzer/:id/run
  if (req.method === 'POST' && req.url?.match(/^\/api\/analyzer\/[^/]+\/run$/)) {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const bodyRaw = Buffer.concat(chunks).toString();
      const body = bodyRaw ? JSON.parse(bodyRaw) : {};
      const jobId = String(nextJobId++);
      const analyzerId = req.url.replace('/api/analyzer/', '').replace('/run', '');
      const job = {
        id: jobId,
        _id: jobId,
        _type: 'job',
        analyzerId,
        workerId: analyzerId,
        analyzerName: analyzerId.split('_sample1')[0] || analyzerId,
        workerName: analyzerId.split('_sample1')[0] || analyzerId,
        analyzerDefinitionId: analyzerId.split('_sample1')[0] || analyzerId,
        workerDefinitionId: analyzerId.split('_sample1')[0] || analyzerId,
        status: 'Waiting',
        dataType: body.dataType || 'ip',
        data: body.data || '',
        message: body.message || '',
        tlp: body.tlp ?? 2,
        date: new Date().toISOString(),
        createdAt: Date.now(),
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(job));
      log('created job', jobId);
    });
    return;
  }

  // GET /api/job/:id/report
  if (req.method === 'GET' && req.url?.match(/^\/api\/job\/[^/]+\/report$/)) {
    const jobId = req.url.replace('/api/job/', '').replace('/report', '');
    if (jobId === '1') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(sampleReport));
    } else if (jobId === '2') {
      // InProgress
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: '2', status: 'InProgress', report: 'Running' }));
    } else {
      // Failure
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: jobId,
        status: 'Failure',
        report: { success: false, errorMessage: 'Analysis failed: timeout' },
      }));
    }
    return;
  }

  // GET /api/job
  if (req.method === 'GET' && req.url?.startsWith('/api/job')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(sampleJobs));
    return;
  }

  // GET /api/job/:id (single status)
  if (req.method === 'GET' && req.url?.match(/^\/api\/job\/[^/]+$/)) {
    const jobId = req.url.replace('/api/job/', '');
    const job = sampleJobs.find((j) => j.id === jobId);
    if (job) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(job));
    } else {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'NotFound', message: `Job ${jobId} not found` }));
    }
    return;
  }

  // POST /api/job/status (batch status)
  if (req.method === 'POST' && req.url === '/api/job/status') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const bodyRaw = Buffer.concat(chunks).toString();
      const body = bodyRaw ? JSON.parse(bodyRaw) : {};
      const jobIds = body.jobIds || [];
      const statuses = {};
      for (const jobId of jobIds) {
        const job = sampleJobs.find((j) => j.id === jobId);
        statuses[jobId] = job ? job.status : 'NotFound';
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(statuses));
    });
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

server.listen(httpPort, () =>
  log(
    `listening on :${httpPort} (GET /api/analyzer, GET /api/analyzer/type/:dataType, POST /api/analyzer/:id/run, GET /api/job/:id/report, GET /api/job, GET /api/job/:id, POST /api/job/status)`
  )
);
