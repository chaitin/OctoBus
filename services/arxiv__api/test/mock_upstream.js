// Mock arXiv export API server for arxiv__api tests.
//
// Serves realistic Atom 1.0 responses on GET /api/query and reacts to
// marker search queries / id lists so the test suite can exercise success,
// error feed, HTTP error, empty result, and malformed payload paths without
// touching the real arXiv service.
import http from 'node:http';

// ---------------------------------------------------------------------------
// Canned entries (shaped like real arXiv API responses)
// ---------------------------------------------------------------------------

export const ENTRY_A = `
<entry>
  <id>http://arxiv.org/abs/0710.5765v2</id>
  <title>Halo Gas Cross Sections And Covering Fractions of MgII Absorption Selected Galaxies</title>
  <updated>2008-02-07T23:18:45Z</updated>
  <link href="https://arxiv.org/abs/0710.5765v2" rel="alternate" type="text/html"/>
  <link href="https://arxiv.org/pdf/0710.5765v2" rel="related" type="application/pdf" title="pdf"/>
  <summary>We examine halo gas cross sections and covering fractions of MgII absorption selected galaxies.</summary>
  <category term="astro-ph" scheme="http://arxiv.org/schemas/atom"/>
  <published>2007-10-30T21:18:23Z</published>
  <arxiv:comment>6 pages, 2 figures, Includes Revised Galaxy Luminosities</arxiv:comment>
  <arxiv:primary_category term="astro-ph"/>
  <arxiv:journal_ref>Astron.J.135:922-927,2008</arxiv:journal_ref>
  <author>
    <name>G. G. Kacprzak</name>
    <arxiv:affiliation>NMSU</arxiv:affiliation>
  </author>
  <author>
    <name>M. T. Murphy</name>
    <arxiv:affiliation>IoA</arxiv:affiliation>
    <arxiv:affiliation>Swinburne</arxiv:affiliation>
  </author>
  <arxiv:doi>10.1088/0004-6256/135/3/922</arxiv:doi>
  <link rel="related" href="https://doi.org/10.1088/0004-6256/135/3/922" title="doi"/>
</entry>`;

export const ENTRY_A_V1 = `
<entry>
  <id>http://arxiv.org/abs/0710.5765v1</id>
  <title>Halo Gas Cross Sections And Covering Fractions of MgII Absorption Selected Galaxies</title>
  <updated>2007-10-30T21:18:23Z</updated>
  <link href="https://arxiv.org/abs/0710.5765v1" rel="alternate" type="text/html"/>
  <link href="https://arxiv.org/pdf/0710.5765v1" rel="related" type="application/pdf" title="pdf"/>
  <summary>First submitted version of the halo gas study.</summary>
  <category term="astro-ph" scheme="http://arxiv.org/schemas/atom"/>
  <published>2007-10-30T21:18:23Z</published>
  <arxiv:primary_category term="astro-ph"/>
  <author>
    <name>G. G. Kacprzak</name>
    <arxiv:affiliation>NMSU</arxiv:affiliation>
  </author>
</entry>`;

const ENTRY_B = `
<entry>
  <id>http://arxiv.org/abs/2609.04165v1</id>
  <title>Parameterised graph theory for tensor networks</title>
  <updated>2026-09-03T17:50:38Z</updated>
  <link href="https://arxiv.org/abs/2609.04165v1" rel="alternate" type="text/html"/>
  <link href="https://arxiv.org/pdf/2609.04165v1" rel="related" type="application/pdf" title="pdf"/>
  <summary>Parameterised graph theory studies how the complexity of graph-theoretic problems depends on structural parameters of the input graph.</summary>
  <category term="quant-ph" scheme="http://arxiv.org/schemas/atom"/>
  <category term="cs.DS" scheme="http://arxiv.org/schemas/atom"/>
  <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
  <published>2026-09-03T17:50:38Z</published>
  <arxiv:primary_category term="quant-ph"/>
  <author>
    <name>Ada Lovelace</name>
  </author>
  <author>
    <name>Alan Turing</name>
    <arxiv:affiliation>Princeton</arxiv:affiliation>
  </author>
  <author>
    <name>Grace Hopper</name>
  </author>
</entry>`;

export const ENTRY_C = `
<entry>
  <id>http://arxiv.org/abs/hep-ex/0307015v1</id>
  <title>Multi-Electron Production at High Transverse Momenta in ep Collisions at HERA</title>
  <updated>2003-07-07T13:46:39Z</updated>
  <link href="https://arxiv.org/abs/hep-ex/0307015v1" rel="alternate" type="text/html"/>
  <link href="https://arxiv.org/pdf/hep-ex/0307015v1" rel="related" type="application/pdf" title="pdf"/>
  <summary>Multi-electron production is studied at high transverse momentum in ep collisions.</summary>
  <category term="hep-ex" scheme="http://arxiv.org/schemas/atom"/>
  <published>2003-07-07T13:46:39Z</published>
  <arxiv:primary_category term="hep-ex"/>
  <arxiv:comment>23 pages, 8 figures and 4 tables</arxiv:comment>
  <author>
    <name>H1 Collaboration</name>
  </author>
</entry>`;

const ERROR_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns="http://www.w3.org/2005/Atom">
  <id>http://arxiv.org/api/errors</id>
  <title>arXiv Search Results</title>
  <updated>2026-09-06T05:18:40Z</updated>
  <link href="https://arxiv.org/api/errors" rel="alternate" type="text/html"/>
  <opensearch:itemsPerPage>1</opensearch:itemsPerPage>
  <opensearch:totalResults>1</opensearch:totalResults>
  <opensearch:startIndex>0</opensearch:startIndex>
  <entry>
    <id>http://arxiv.org/api/errors</id>
    <title>Error</title>
    <summary>sortBy must be in: relevance, lastUpdatedDate, submittedDate</summary>
    <updated>2026-09-06T05:18:40Z</updated>
    <link href="https://arxiv.org/api/errors" rel="alternate" type="text/html"/>
    <author>
      <name>arXiv api core</name>
    </author>
  </entry>
</feed>`;

const KNOWN_IDS = new Map([
  ['0710.5765', ENTRY_A],
  ['0710.5765v1', ENTRY_A_V1],
  ['0710.5765v2', ENTRY_A],
  ['2609.04165', ENTRY_B],
  ['hep-ex/0307015', ENTRY_C],
  ['hep-ex/0307015v1', ENTRY_C],
]);

export const wrapFeed = ({ entries = '', totalResults = 0, startIndex = 0, itemsPerPage = 0 } = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns="http://www.w3.org/2005/Atom">
  <id>http://arxiv.org/api/mock-feed</id>
  <title>arXiv Query: mock</title>
  <updated>2026-09-06T05:18:26Z</updated>
  <link href="https://arxiv.org/api/query" type="application/atom+xml"/>
  <opensearch:itemsPerPage>${itemsPerPage}</opensearch:itemsPerPage>
  <opensearch:totalResults>${totalResults}</opensearch:totalResults>
  <opensearch:startIndex>${startIndex}</opensearch:startIndex>${entries}
</feed>`;

const searchFeed = (url) => {
  const start = Number(url.searchParams.get('start') || 0);
  const max = Number(url.searchParams.get('max_results') || 10);
  const entries = `${ENTRY_A}\n${ENTRY_B}`;
  return wrapFeed({
    entries,
    totalResults: 42,
    startIndex: start,
    itemsPerPage: Math.min(2, max),
  });
};

const idListFeed = (idList) => {
  const ids = idList.split(',').map((id) => id.trim()).filter(Boolean);
  const found = [];
  for (const id of ids) {
    const entry = KNOWN_IDS.get(id);
    if (entry) found.push(entry);
  }
  return wrapFeed({
    entries: found.join('\n'),
    totalResults: found.length,
    itemsPerPage: found.length,
  });
};

const emptyFeed = wrapFeed({});

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export function createMockServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method !== 'GET' || url.pathname !== '/api/query') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }

    const searchQuery = (url.searchParams.get('search_query') || '').trim();

    if (searchQuery === 'ERRORFEED') {
      res.writeHead(200, { 'Content-Type': 'application/atom+xml' });
      res.end(ERROR_FEED);
      return;
    }
    if (searchQuery === 'FAIL400') {
      res.writeHead(400, { 'Content-Type': 'application/atom+xml' });
      res.end(ERROR_FEED);
      return;
    }
    if (searchQuery === 'FAIL500') {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('internal server error');
      return;
    }
    if (searchQuery === 'FORBIDDEN') {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('forbidden');
      return;
    }
    if (searchQuery === 'RATELIMIT') {
      res.writeHead(429, { 'Content-Type': 'text/plain' });
      res.end('too many requests');
      return;
    }
    if (searchQuery === 'BADXML') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body>definitely not atom</body></html>');
      return;
    }
    if (searchQuery === 'MALFORMEDXML') {
      res.writeHead(200, { 'Content-Type': 'application/atom+xml' });
      res.end('<feed><entry></feed>');
      return;
    }
    if (searchQuery === 'NO_RESULTS') {
      res.writeHead(200, { 'Content-Type': 'application/atom+xml' });
      res.end(emptyFeed);
      return;
    }
    if (searchQuery) {
      res.writeHead(200, { 'Content-Type': 'application/atom+xml' });
      res.end(searchFeed(url));
      return;
    }

    const idList = (url.searchParams.get('id_list') || '').trim();
    if (idList) {
      res.writeHead(200, { 'Content-Type': 'application/atom+xml' });
      res.end(idListFeed(idList));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/atom+xml' });
    res.end(emptyFeed);
  });
}

// Standalone runner: node test/mock_upstream.js
// When executed by the node:test runner (NODE_TEST_CONTEXT=child-v8) we only
// expose the factory so discovery does not block on a live server.
const isStandalone = process.argv[1]
  && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isStandalone && process.env.NODE_TEST_CONTEXT !== 'child-v8') {
  const port = Number(process.env.HTTP_PORT || 19100);
  createMockServer().listen(port, () => {
    console.log(`[mock-arxiv] listening on http://127.0.0.1:${port}`);
  });
}
