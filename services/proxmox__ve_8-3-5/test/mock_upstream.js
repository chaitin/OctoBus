import http from 'node:http';

export const TOKEN_ID = 'root@pam!automation';
export const TOKEN_SECRET = '11111111-2222-3333-4444-555555555555';
export const DEFAULT_NODE = 'pve-node-1';

const VALID_TOKEN_HEADER = `PVEAPIToken=${TOKEN_ID}=${TOKEN_SECRET}`;

const send = (res, status, body, headers = {}) => {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(payload);
};

const notFound = (res, message = 'not found') => {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(message);
};

const parseVmid = (value) => {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) return null;
  return num;
};

export function createMockServer({
  expectedTokenId = TOKEN_ID,
  expectedTokenSecret = TOKEN_SECRET,
} = {}) {
  const requests = [];
  const expectedAuth = `PVEAPIToken=${expectedTokenId}=${expectedTokenSecret}`;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    requests.push({ method: req.method, path: url.pathname, headers: req.headers });

    if (req.method !== 'GET') {
      send(res, 405, { errors: [{ msg: 'method not allowed' }] });
      return;
    }

    const auth = String(req.headers.authorization || '');
    if (!auth) {
      send(res, 401, { errors: [{ msg: 'missing Authorization header' }] });
      return;
    }
    if (auth !== expectedAuth) {
      send(res, 403, { errors: [{ msg: 'invalid PVEAPIToken' }] });
      return;
    }

    if (url.pathname === '/api2/json/nodes') {
      send(res, 200, {
        data: [
          {
            node: 'pve-node-1',
            status: 'online',
            level: 'c',
            ip: '10.0.0.11',
            cpu: 0.12,
            cpu_count: 16,
            maxcpu: 16,
            mem: 8589934592,
            maxmem: 34359738368,
            disk: 107374182400,
            maxdisk: 536870912000,
            uptime: 9000,
          },
          {
            node: 'pve-node-2',
            status: 'offline',
            level: '',
            ip: '10.0.0.12',
            cpu: 0,
            cpu_count: 8,
            maxcpu: 8,
            mem: 0,
            maxmem: 16777216000,
            disk: 0,
            maxdisk: 268435456000,
            uptime: 0,
          },
        ],
      });
      return;
    }

    const qemuListMatch = /^\/api2\/json\/nodes\/([^/]+)\/qemu$/.exec(url.pathname);
    if (qemuListMatch) {
      const node = decodeURIComponent(qemuListMatch[1]);
      if (node !== 'pve-node-1' && node !== 'pve-node-2') {
        send(res, 500, { errors: [{ msg: `node "${node}" not found` }] });
        return;
      }
      send(res, 200, {
        data: [
          {
            vmid: 100,
            name: 'web-1',
            status: 'running',
            cpus: 2,
            maxmem: 2147483648,
            mem: 1073741824,
            disk: 10737418240,
            maxdisk: 21474836480,
            uptime: 12345,
            node,
            template: 0,
          },
          {
            vmid: 101,
            name: 'db-1',
            status: 'stopped',
            cpus: 4,
            maxmem: 4294967296,
            mem: 0,
            disk: 21474836480,
            maxdisk: 32212254720,
            uptime: 0,
            node,
            template: 0,
          },
        ],
      });
      return;
    }

    const qemuConfigMatch = /^\/api2\/json\/nodes\/([^/]+)\/qemu\/([^/]+)\/config$/.exec(url.pathname);
    if (qemuConfigMatch) {
      const node = decodeURIComponent(qemuConfigMatch[1]);
      const vmid = parseVmid(decodeURIComponent(qemuConfigMatch[2]));
      if (!vmid) {
        send(res, 400, { errors: [{ msg: 'invalid vmid' }] });
        return;
      }
      send(res, 200, {
        data: {
          vmid,
          name: `vm-${vmid}`,
          memory: 2048,
          cores: 2,
          sockets: 1,
          ostype: 'l26',
          scsihw: 'virtio-scsi-pci',
          boot: 'order=scsi0',
          net0: 'virtio=00:11:22:33:44:55,bridge=vmbr0',
        },
      });
      return;
    }

    const lxcListMatch = /^\/api2\/json\/nodes\/([^/]+)\/lxc$/.exec(url.pathname);
    if (lxcListMatch) {
      const node = decodeURIComponent(lxcListMatch[1]);
      send(res, 200, {
        data: [
          {
            vmid: 200,
            name: 'lxc-web',
            status: 'running',
            cpus: 1,
            maxmem: 536870912,
            mem: 268435456,
            disk: 4294967296,
            maxdisk: 8589934592,
            uptime: 60,
            node,
            template: 0,
          },
        ],
      });
      return;
    }

    const storageListMatch = /^\/api2\/json\/nodes\/([^/]+)\/storage$/.exec(url.pathname);
    if (storageListMatch) {
      const node = decodeURIComponent(storageListMatch[1]);
      send(res, 200, {
        data: [
          {
            storage: 'local',
            type: 'dir',
            total: 107374182400,
            used: 21474836480,
            avail: 85899345920,
            used_fraction: 0.2,
            content: 'iso,vztmpl,backup',
            active: '1',
            enabled: '1',
            shared: false,
          },
          {
            storage: 'nfs-pool',
            type: 'nfs',
            total: 1099511627776,
            used: 549755813888,
            avail: 549755813888,
            used_fraction: 0.5,
            content: 'images,rootdir',
            active: '1',
            enabled: '1',
            shared: true,
          },
        ],
      });
      return;
    }

    const statusMatch = /^\/api2\/json\/nodes\/([^/]+)\/status$/.exec(url.pathname);
    if (statusMatch) {
      const node = decodeURIComponent(statusMatch[1]);
      send(res, 200, {
        data: {
          node,
          status: 'online',
          uptime: 12345,
          loadavg: [0.12, 0.34, 0.56],
          cpu_count: 16,
          cpu_usage: 0.18,
          memory: { total: 34359738368, used: 17179869184, free: 17179869184 },
          swap: { total: 8589934592, used: 0, free: 8589934592 },
          kversion: 'Linux 6.8.4-2-pve',
          pveversion: 'pve-manager/8.3.5/4562d8152094b115',
          cpuinfo: { model: 'Intel(R) Xeon(R) CPU', cores: 16, mhz: 3200 },
        },
      });
      return;
    }

    notFound(res, `unhandled path: ${url.pathname}`);
  });

  return {
    requests,
    validAuthHeader: VALID_TOKEN_HEADER,
    async start() {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      return {
        baseUrl: `http://${address.address}:${address.port}`,
        origin: `http://${address.address}:${address.port}`,
        port: address.port,
      };
    },
    async close() {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
}