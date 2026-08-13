import { describe, it } from "node:test";
import assert from "node:assert";

import {
  buildRequestBody,
  buildPageResponse,
  API_PATHS,
  MAX_LIMITS,
} from "../src/mappers.js";

describe("buildRequestBody", () => {
  it("defaults offset and limit when all zeros", () => {
    const body = buildRequestBody({ offset: 0, limit: 0 });
    assert.equal(body.offset, 0);
    assert.equal(body.limit, 10);
  });

  it("clamps limit at maxLimit", () => {
    const body = buildRequestBody({ limit: 500 }, { maxLimit: 100 });
    assert.equal(body.limit, 100);
  });

  it("clamps limit at largeTable max", () => {
    const body = buildRequestBody({ limit: 200 }, { maxLimit: 10 });
    assert.equal(body.limit, 10);
  });

  it("clamps negative offset to 0", () => {
    const body = buildRequestBody({ offset: -5 });
    assert.equal(body.offset, 0);
  });

  it("preserves valid offset and limit", () => {
    const body = buildRequestBody({ offset: 20, limit: 30 });
    assert.equal(body.offset, 20);
    assert.equal(body.limit, 30);
  });

  it("includes loginName when provided", () => {
    const body = buildRequestBody({ loginName: "testuser" });
    assert.equal(body.login_name, "testuser");
  });

  it("excludes login_name when not provided", () => {
    const body = buildRequestBody({});
    assert.ok(!("login_name" in body));
  });

  it("parses filter JSON string", () => {
    const body = buildRequestBody({ filter: '{"asset_code":"Dev-ABC"}' });
    assert.deepEqual(body.filter, { asset_code: "Dev-ABC" });
  });

  it("ignores empty filter string", () => {
    const body = buildRequestBody({ filter: "" });
    assert.ok(!body.filter);
  });

  it("ignores blank filter string", () => {
    const body = buildRequestBody({ filter: "   " });
    assert.ok(!body.filter);
  });

  it("rejects invalid JSON filter", () => {
    assert.throws(
      () => buildRequestBody({ filter: "{not json" }),
      /filter must be valid JSON/
    );
  });

  it("rejects non-object JSON filter (primitive)", () => {
    assert.throws(
      () => buildRequestBody({ filter: "123" }),
      /filter must be a JSON object/
    );
  });

  it("rejects non-object JSON filter (null)", () => {
    assert.throws(
      () => buildRequestBody({ filter: "null" }),
      /filter must be a JSON object/
    );
  });

  it("rejects non-object JSON filter (array)", () => {
    assert.throws(
      () => buildRequestBody({ filter: "[1,2,3]" }),
      /filter must be a JSON object/
    );
  });
});

describe("buildPageResponse", () => {
  it("returns json string with items and total", () => {
    const raw = {
      items: [{ name: "Item1" }, { name: "Item2" }],
      total: 100,
    };
    const resp = buildPageResponse(raw, { offset: 0, limit: 10 });
    const data = JSON.parse(resp.json);
    assert.equal(data.total, 100);
    assert.equal(data.items.length, 2);
    // Fields are plain JSON, no proto Struct wrapper
    assert.equal(data.items[0].name, "Item1");
  });

  it("handles empty items", () => {
    const resp = buildPageResponse({ items: [], total: 0 });
    const data = JSON.parse(resp.json);
    assert.deepEqual(data.items, []);
    assert.equal(data.total, 0);
  });

  it("handles missing total", () => {
    const resp = buildPageResponse({ items: [{ x: 1 }] });
    const data = JSON.parse(resp.json);
    assert.equal(data.total, 0);
    assert.equal(data.items.length, 1);
  });

  it("client-side slices to requested limit", () => {
    const raw = {
      items: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }],
      total: 100,
    };
    const resp = buildPageResponse(raw, { offset: 0, limit: 2 });
    const data = JSON.parse(resp.json);
    assert.equal(data.total, 100);
    assert.equal(data.items.length, 2);
    assert.equal(data.items[0].id, 1);
  });

  it("client-side slices with offset", () => {
    const raw = {
      items: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }],
      total: 100,
    };
    const resp = buildPageResponse(raw, { offset: 2, limit: 2 });
    const data = JSON.parse(resp.json);
    assert.equal(data.items.length, 2);
    assert.equal(data.items[0].id, 3);
    assert.equal(data.items[1].id, 4);
  });

  it("preserves null, nested objects, arrays", () => {
    const raw = {
      items: [{
        name: "test",
        value: null,
        nested: { inner: "val" },
        arr: [1, 2, 3],
        flag: true,
      }],
      total: 1,
    };
    const resp = buildPageResponse(raw);
    const data = JSON.parse(resp.json);
    const item = data.items[0];
    assert.equal(item.name, "test");
    assert.equal(item.value, null);
    assert.deepEqual(item.nested, { inner: "val" });
    assert.deepEqual(item.arr, [1, 2, 3]);
    assert.equal(item.flag, true);
  });
});

describe("API_PATHS", () => {
  it("has expected path mappings", () => {
    assert.equal(API_PATHS.dev, "/api/entity/dev");
    assert.equal(API_PATHS.service, "/api/entity/service");
    assert.equal(API_PATHS.user, "/api/system/user/list");
  });
});

describe("MAX_LIMITS", () => {
  it("has expected values", () => {
    assert.equal(MAX_LIMITS.default, 100);
    assert.equal(MAX_LIMITS.largeTable, 10);
  });
});
