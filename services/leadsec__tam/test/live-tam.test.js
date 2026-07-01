import { describe, it } from 'node:test';

import { handlers, METHOD_ADD_BLACKLIST_FULL, METHOD_ADD_WHITELIST_FULL } from '../src/leadsec-tam.js';

const LIVE_ENABLED = process.env.LEADSEC_TAM_LIVE === '1';

const liveCtx = (ip, method) => ({
  config: {
    baseUrl: process.env.LEADSEC_TAM_BASE_URL,
    skipTlsVerify: process.env.LEADSEC_TAM_SKIP_TLS_VERIFY !== '0',
    remark: process.env.LEADSEC_TAM_REMARK || 'OctoBus live test',
  },
  secret: {
    username: process.env.LEADSEC_TAM_USERNAME,
    password: process.env.LEADSEC_TAM_PASSWORD,
  },
  req: {
    ip_list: [ip],
    request_id: `live-${method}-${Date.now()}`,
  },
});

describe('leadsec-TAM live test', { skip: !LIVE_ENABLED }, () => {
  it('adds blacklist IP in a real Leadsec TAM environment', async () => {
    await handlers[METHOD_ADD_BLACKLIST_FULL](liveCtx(process.env.LEADSEC_TAM_BLACK_IP || '203.0.113.10', 'black'));
  });

  it('adds whitelist IP in a real Leadsec TAM environment', async () => {
    await handlers[METHOD_ADD_WHITELIST_FULL](liveCtx(process.env.LEADSEC_TAM_WHITE_IP || '203.0.113.11', 'white'));
  });
});
