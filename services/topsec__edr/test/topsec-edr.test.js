// Unit tests for topsec-edr service.
// Run with: node --test test/topsec-edr.test.js
//
// Note: Tests that import the service module require the @chaitin-ai/octobus-sdk
// to be installed (available in the OctoBus build environment).
// The crypto/utility tests below can run standalone.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  mockLoginResponse,
  decryptLoginBody,
  validateSignedQuery,
  mockListClientsResponse,
  mockGetClientResponse,
  mockDashboardResponse,
  mockSystemInfoResponse,
  MOCK,
} from './mock_upstream.js';

// Replicate pure functions from the service for standalone testing
const AES_KEY = MOCK.AES_KEY;
const AES_IV = MOCK.AES_IV;

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

const computeSign = (nonce, stime, token) => {
  const raw = String(token || '') + String(stime || '') + String(nonce || '') + 'dO(QK*EX@cTG';
  return crypto.createHash('md5').update(raw, 'utf8').digest('hex');
};

// --- AES Encryption/Decryption Tests ---

describe('AES-256-CBC encryption/decryption', () => {
  it('should roundtrip ASCII text', () => {
    assert.equal(decryptAes256Cbc(encryptAes256Cbc('admin')), 'admin');
  });

  it('should roundtrip empty string', () => {
    assert.equal(decryptAes256Cbc(encryptAes256Cbc('')), '');
  });

  it('should roundtrip long text (multi-block)', () => {
    const long = 'ThisIsAVeryLongPasswordThatSpansMultipleAESBlocks123456789';
    assert.equal(decryptAes256Cbc(encryptAes256Cbc(long)), long);
  });

  it('should roundtrip Chinese characters', () => {
    assert.equal(decryptAes256Cbc(encryptAes256Cbc('天融信EDR')), '天融信EDR');
  });

  it('should produce different ciphertext for different inputs', () => {
    assert.notEqual(encryptAes256Cbc('admin'), encryptAes256Cbc('user1'));
  });

  it('should produce deterministic ciphertext for same input', () => {
    assert.equal(encryptAes256Cbc('admin'), encryptAes256Cbc('admin'));
  });
});

// --- Signature Tests ---

describe('computeSign', () => {
  it('should produce a 32-char hex MD5', () => {
    const sign = computeSign('nonce123', '1719000000', 'jwt_token_here');
    assert.equal(sign.length, 32);
    assert.match(sign, /^[0-9a-f]{32}$/);
  });

  it('should be consistent for same inputs', () => {
    assert.equal(computeSign('abc', '123', 'xyz'), computeSign('abc', '123', 'xyz'));
  });

  it('should differ for different inputs', () => {
    assert.notEqual(computeSign('abc', '123', 'xyz'), computeSign('def', '456', 'uvw'));
  });

  it('should match MOCK constants', () => {
    const expectedSign = computeSign(MOCK.NONCE, MOCK.STIME, MOCK.TOKEN);
    assert.equal(expectedSign, MOCK.SIGN);
  });
});

// --- Mock Upstream Tests ---

describe('mock login response', () => {
  it('should produce a valid encryptStr that decrypts to token/nonce/stime', () => {
    const responseBody = mockLoginResponse();
    const parsed = JSON.parse(responseBody);
    assert.ok(parsed.encryptStr, 'response should have encryptStr');

    const decrypted = decryptAes256Cbc(parsed.encryptStr);
    const decoded = JSON.parse(decrypted);
    assert.equal(decoded.token, MOCK.TOKEN);
    assert.equal(decoded.nonce, MOCK.NONCE);
    assert.equal(decoded.stime, MOCK.STIME);
  });
});

describe('decrypt login body', () => {
  it('should decrypt encrypted credentials from request body (encryptStr format)', () => {
    // Actual EDR login body format: { encryptStr: AES(JSON) }
    const payload = JSON.stringify({ 'ng-cloud': true, username: 'admin', password: 'hashedPwd123', captcha: '', tenant_id: '', captcha_id: '' });
    const body = JSON.stringify({ encryptStr: encryptAes256Cbc(payload) });
    const { username, password } = decryptLoginBody(body);
    assert.equal(username, 'admin');
    assert.equal(password, 'hashedPwd123');
  });
});

describe('validate signed query', () => {
  it('should accept valid signed query', () => {
    const query = {
      nonce: MOCK.NONCE,
      stime: MOCK.STIME,
      token: MOCK.TOKEN,
      sign: MOCK.SIGN,
    };
    assert.equal(validateSignedQuery(query), true);
  });

  it('should reject invalid sign', () => {
    const query = {
      nonce: MOCK.NONCE,
      stime: MOCK.STIME,
      token: MOCK.TOKEN,
      sign: 'invalid_sign',
    };
    assert.equal(validateSignedQuery(query), false);
  });

  it('should reject tampered token', () => {
    const query = {
      nonce: MOCK.NONCE,
      stime: MOCK.STIME,
      token: 'tampered_token',
      sign: MOCK.SIGN,
    };
    assert.equal(validateSignedQuery(query), false);
  });
});

describe('mock list clients response', () => {
  it('should return paginated client list', () => {
    const body = mockListClientsResponse(1, 25);
    const parsed = JSON.parse(body);
    assert.equal(parsed.data.total, 2);
    assert.equal(parsed.data.list.length, 2);
    assert.equal(parsed.data.list[0].client_id, 'client-001');
  });

  it('should return empty list for out-of-range page', () => {
    const body = mockListClientsResponse(2, 25);
    const parsed = JSON.parse(body);
    assert.equal(parsed.data.list.length, 0);
  });
});

describe('mock get client response', () => {
  it('should return client by id', () => {
    const body = mockGetClientResponse('client-001');
    const parsed = JSON.parse(body);
    assert.equal(parsed.data.client_id, 'client-001');
    assert.equal(parsed.data.hostname, 'WORKSTATION-01');
  });

  it('should return null for unknown client', () => {
    const body = mockGetClientResponse('unknown-id');
    const parsed = JSON.parse(body);
    assert.equal(parsed.data, null);
  });
});

describe('mock dashboard response', () => {
  it('should contain alert stats and system view', () => {
    const body = mockDashboardResponse();
    const parsed = JSON.parse(body);
    assert.ok(parsed.data.scan);
    assert.ok(parsed.data.view);
    assert.ok(parsed.data.server);
    assert.ok(parsed.data.license);
    assert.equal(parsed.data.scan.threats_num, 15);
    assert.equal(parsed.data.view.terminal_all, 150);
  });
});

describe('mock system info response', () => {
  it('should contain resource usage data', () => {
    const body = mockSystemInfoResponse();
    const parsed = JSON.parse(body);
    assert.equal(parsed.data.disk_usage, 65);
    assert.equal(parsed.data.cpu_usage, 35);
    assert.equal(parsed.data.memory_usage, 72);
  });
});
