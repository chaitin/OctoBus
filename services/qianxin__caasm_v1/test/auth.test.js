import { describe, it } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";

import { buildAuthHeader } from "../src/auth.js";

describe("buildAuthHeader", () => {
  it("returns required fields", () => {
    const result = buildAuthHeader("myKey", "mySecret");
    assert.ok(result.header, "header should exist");
    assert.ok(result.nonce, "nonce should exist");
    assert.ok(result.timestamp, "timestamp should exist");
  });

  it("header contains expected key-value pairs", () => {
    const result = buildAuthHeader("testKey", "testSecret");
    assert.match(result.header, /appKey=testKey/);
    assert.match(result.header, /nonce=\d{6}/);
    assert.match(result.header, /timestamp=\d{10}/);
    assert.match(result.header, /version=1\.0\.0/);
    assert.match(result.header, /signature=[a-f0-9]{64}/);
  });

  it("nonce is a 6-digit string", () => {
    const result = buildAuthHeader("k", "s");
    assert.match(result.nonce, /^\d{6}$/);
  });

  it("timestamp is recent (within 5 seconds)", () => {
    const result = buildAuthHeader("k", "s");
    const now = Math.floor(Date.now() / 1000);
    assert.ok(Math.abs(now - result.timestamp) < 5, "timestamp should be within 5s");
  });

  it("produces a valid HMAC-SHA256 signature", () => {
    const appKey = "myAppKey";
    const appSecret = "myAppSecret";
    const result = buildAuthHeader(appKey, appSecret);

    // Recompute the expected signature
    const expectedSignStr = `appKey:${appKey}&nonce:${result.nonce}&timestamp:${result.timestamp}`;
    const expectedSig = crypto
      .createHmac("sha256", appSecret)
      .update(expectedSignStr)
      .digest("hex");

    const actualSig = result.header.split("signature=")[1];
    assert.equal(actualSig, expectedSig);
  });

  it("produces different signatures with different nonces", () => {
    const r1 = buildAuthHeader("key", "secret");
    const r2 = buildAuthHeader("key", "secret");
    // Nonces should differ (random), so signatures should differ too
    if (r1.nonce !== r2.nonce) {
      assert.notEqual(
        r1.header.split("signature=")[1],
        r2.header.split("signature=")[1]
      );
    }
    // But the key part should remain the same
    assert.match(r1.header, /appKey=key/);
    assert.match(r2.header, /appKey=key/);
  });

  it("produces different signatures for different secrets", () => {
    const r1 = buildAuthHeader("sameKey", "secret1");
    const r2 = buildAuthHeader("sameKey", "secret2");
    // With same key and likely same timestamp but different secrets,
    // signatures should differ
    assert.notEqual(
      r1.header.split("signature=")[1],
      r2.header.split("signature=")[1]
    );
  });
});
