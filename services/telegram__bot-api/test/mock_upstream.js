export const createMockServer = ({ onRequest } = {}) => {
  const calls = [];

  return {
    calls,
    fetch: async (url, init = {}) => {
      const call = { url: String(url), init };
      calls.push(call);
      if (onRequest) return onRequest(call, calls.length);
      return {
        status: 200,
        text: async () => JSON.stringify({ ok: true, result: {} }),
      };
    },
  };
};
