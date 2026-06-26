// Mock upstream server for TopSec EDR integration tests.
// Simulates the EDR management center API responses.

import crypto from 'node:crypto';

const AES_KEY = '6ZlcPK5xfRrd7W1oyIqVgiHGbamhBAJ3';
const AES_IV = AES_KEY.slice(0, 16);

const encryptAes256Cbc = (plaintext) => {
  const key = Buffer.from(AES_KEY, 'utf8');
  const iv = Buffer.from(AES_IV, 'utf8');
  const input = Buffer.from(String(plaintext || ''), 'utf8');
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  // PKCS7 padding (Node.js default) — matches the main service implementation
  return Buffer.concat([cipher.update(input), cipher.final()]).toString('base64');
};

const decryptAes256Cbc = (ciphertextB64) => {
  const key = Buffer.from(AES_KEY, 'utf8');
  const iv = Buffer.from(AES_IV, 'utf8');
  const ciphertext = Buffer.from(String(ciphertextB64 || '').replace(/\s+/g, ''), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  // PKCS7 padding (Node.js default) — matches the main service implementation
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
};

const SIGN_SALT = 'dO(QK*EX@cTG';

// Mock token for authenticated requests
const MOCK_TOKEN = 'mock_jwt_token_edr_2024';
const MOCK_NONCE = 'mock_nonce_abc';
const MOCK_STIME = '1719300000';
const MOCK_SIGN = crypto.createHash('md5').update(MOCK_TOKEN + MOCK_STIME + MOCK_NONCE + SIGN_SALT, 'utf8').digest('hex');

// Mock terminal data
const MOCK_CLIENTS = [
  {
    client_id: 'client-001',
    hostname: 'WORKSTATION-01',
    mac: '00:11:22:33:44:55',
    client_ip: '192.168.1.100',
    os_name: 'Windows 10',
    os_version: '10.0.19045',
    os_arch: '64 位',
    client_version: '3.2.1.0',
    virus_db_version: 1719200000,
    group_name: '研发部',
    group_id: 'group-001',
    person: '张三',
    terminal_type: '工作站',
    location: 'A栋3层',
    login_time: 1719250000,
    heartbeat_time: 1719300000,
    status: 1,
    os_type: 'windows',
    tenancy_id: 'tenancy-001',
  },
  {
    client_id: 'client-002',
    hostname: 'SERVER-DB-01',
    mac: '00:11:22:33:44:66',
    client_ip: '192.168.1.200',
    os_name: 'openEuler',
    os_version: '22.03 LTS SP3',
    os_arch: '64 位',
    client_version: '3.2.1.0',
    virus_db_version: 1719200000,
    group_name: '运维部',
    group_id: 'group-002',
    person: '李四',
    terminal_type: '服务器',
    location: 'B栋机房',
    login_time: 1719240000,
    heartbeat_time: 1719290000,
    status: 1,
    os_type: 'linux',
    tenancy_id: 'tenancy-001',
  },
];

/**
 * Build a mock login response matching EDR's format.
 * The response contains an encryptStr field that, when decrypted,
 * yields a JSON object with token, nonce, and stime.
 */
export const mockLoginResponse = () => {
  const payload = JSON.stringify({
    token: MOCK_TOKEN,
    nonce: MOCK_NONCE,
    stime: MOCK_STIME,
  });
  const encryptStr = encryptAes256Cbc(payload);
  return JSON.stringify({ encryptStr });
};

/**
 * Validate that a login request body contains properly encrypted credentials.
 * The actual EDR login body format is { encryptStr: AES(JSON) } where
 * the encrypted JSON contains username and hashedPassword.
 * Returns the decrypted username and password hash.
 */
export const decryptLoginBody = (body) => {
  const parsed = JSON.parse(body);
  const encryptStr = parsed.encryptStr;
  if (encryptStr) {
    const decrypted = decryptAes256Cbc(encryptStr);
    const decoded = JSON.parse(decrypted);
    return { username: decoded.username, password: decoded.password };
  }
  // Fallback: legacy format { username: enc, password: enc }
  const username = decryptAes256Cbc(parsed.username);
  const password = decryptAes256Cbc(parsed.password);
  return { username, password };
};

/**
 * Validate signed request query params.
 * Returns true if nonce + stime + token produces the expected sign.
 */
export const validateSignedQuery = (query) => {
  const expectedSign = crypto.createHash('md5')
    .update(String(query.token || '') + String(query.stime || '') + String(query.nonce || '') + SIGN_SALT, 'utf8')
    .digest('hex');
  return query.sign === expectedSign;
};

/**
 * Mock response for /api/terminal/list
 */
export const mockListClientsResponse = (page = 1, pageSize = 25) => {
  const start = (page - 1) * pageSize;
  const end = Math.min(start + pageSize, MOCK_CLIENTS.length);
  const list = MOCK_CLIENTS.slice(start, end);
  return JSON.stringify({
    data: {
      list,
      total: MOCK_CLIENTS.length,
    },
  });
};

/**
 * Mock response for /api/terminal/get
 */
export const mockGetClientResponse = (clientId) => {
  const client = MOCK_CLIENTS.find((c) => c.client_id === clientId);
  if (!client) {
    return JSON.stringify({ data: null, message: 'terminal not found' });
  }
  return JSON.stringify({ data: client });
};

/**
 * Mock response for /api/home/dashboard (alert stats + system view)
 */
export const mockDashboardResponse = () => {
  return JSON.stringify({
    data: {
      scan: { threats_num: 15, terminal_num: 3 },
      hi_leak: { threats_num: 8, terminal_num: 2 },
      week_pwd: { threats_num: 5, terminal_num: 5 },
      intrusion: { threats_num: 2, terminal_num: 1 },
      aggregate_virus_value: 120,
      aggregate_ransom_value: 5,
      file_prot: 45,
      exec_prot: 30,
      reg_prot: 20,
      proc_prot: 15,
      risk_blocked: 8,
      virus_immune: 3,
      udev_illegal: 12,
      soft_illegal: 7,
      inner_illegal: 4,
      view: {
        terminal_all: 150,
        terminal_online: 120,
        terminal_banned: 5,
        total_use: 5000,
        windows: 80,
        server: 30,
        linux: 35,
        domestic: 5,
      },
      server: {
        host_name: 'edr-server',
        server_time: '2024-06-25 10:00:00',
      },
      license: {
        user: '测试公司',
        type: '正式授权',
        license_platform: '全平台',
      },
    },
  });
};

/**
 * Mock response for /api/home/systeminfo
 */
export const mockSystemInfoResponse = () => {
  return JSON.stringify({
    data: {
      disk_usage: 65,
      memory_usage: 72,
      cpu_usage: 35,
      network_tx: 1024000,
      network_rx: 512000,
      server_time: '2024-06-25 10:00:00',
    },
  });
};

export const MOCK = {
  TOKEN: MOCK_TOKEN,
  NONCE: MOCK_NONCE,
  STIME: MOCK_STIME,
  SIGN: MOCK_SIGN,
  CLIENTS: MOCK_CLIENTS,
  AES_KEY,
  AES_IV,
};
