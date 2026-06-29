const assert = require('node:assert/strict');

function jsonResponse(status, body, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name) {
        const key = Object.keys(headers).find((item) => item.toLowerCase() === String(name).toLowerCase());
        return key ? headers[key] : null;
      },
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

function createFetchMock() {
  const calls = [];
  const queue = [];

  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (queue.length === 0) throw new Error('No mock response queued');
    const next = queue.shift();
    if (next.error) throw next.error;
    if (typeof next.handler === 'function') return next.handler(url, init, calls);
    return jsonResponse(next.status ?? 200, next.body ?? {}, next.headers ?? {});
  };

  fetch.queueJson = (body, status = 200, headers = {}) => queue.push({ body, status, headers });
  fetch.queueError = (error) => queue.push({ error });
  fetch.queueHandler = (handler) => queue.push({ handler });
  fetch.calls = calls;
  fetch.assertCall = (index, method, path) => {
    assert.equal(calls[index].init.method, method);
    assert.match(calls[index].url, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  };

  return fetch;
}

module.exports = { createFetchMock, jsonResponse };
