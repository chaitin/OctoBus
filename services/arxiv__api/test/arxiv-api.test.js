import { after, before, test } from 'node:test';
import { once } from 'node:events';
import assert from 'node:assert/strict';

import { GrpcError } from '@chaitin-ai/octobus-sdk';

import {
  METHODS,
  _test,
  getPaper,
  handlers,
  listPapers,
  searchPapers,
} from '../src/arxiv-api.js';
import { service } from '../src/service.js';
import { ENTRY_A, createMockServer, wrapFeed } from './mock_upstream.js';

// ---------------------------------------------------------------------------
// Test harness: an in-process mock arXiv server on an ephemeral port.
// ---------------------------------------------------------------------------

let server;
let baseConfig;

before(async () => {
  server = createMockServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseConfig = { baseUrl: `http://127.0.0.1:${server.address().port}`, timeoutMs: 5000 };
});

after(() => {
  server?.close();
});

const expectLegacy = async (fn, legacyCode) => {
  let err;
  try {
    await fn();
  } catch (caught) {
    err = caught;
  }
  assert.ok(err instanceof GrpcError, `expected GrpcError, got: ${err}`);
  assert.equal(err.legacyCode, legacyCode, `unexpected code for: ${err.message}`);
  return err;
};

// ---------------------------------------------------------------------------
// Surface shape
// ---------------------------------------------------------------------------

test('arxiv__api exports a service with all three handlers', () => {
  assert.equal(typeof service, 'object');
  assert.equal(typeof handlers[METHODS.SEARCH_PAPERS], 'function');
  assert.equal(typeof handlers[METHODS.GET_PAPER], 'function');
  assert.equal(typeof handlers[METHODS.LIST_PAPERS], 'function');
});

// ---------------------------------------------------------------------------
// Response mapping (request -> upstream -> proto-shaped objects)
// ---------------------------------------------------------------------------

test('searchPapers maps an Atom feed to papers and feed metadata', async () => {
  const result = await searchPapers(baseConfig, { searchQuery: 'all:quantum AND all:computing' });

  assert.equal(result.meta.totalResults, 42);
  assert.equal(result.meta.itemsPerPage, 2);
  assert.equal(result.papers.length, 2);

  const paperA = result.papers.find((paper) => paper.arxivId === '0710.5765v2');
  const paperB = result.papers.find((paper) => paper.arxivId === '2609.04165v1');

  assert.ok(paperA, 'paper 0710.5765v2 present');
  assert.equal(paperA.title, 'Halo Gas Cross Sections And Covering Fractions of MgII Absorption Selected Galaxies');
  assert.ok(paperA.summary.length > 0, 'abstract parsed');
  assert.equal(paperA.primaryCategory, 'astro-ph');
  assert.equal(paperA.categories.length, 1);
  assert.deepEqual(paperA.categories[0], { term: 'astro-ph', scheme: 'http://arxiv.org/schemas/atom' });
  assert.equal(paperA.comment, '6 pages, 2 figures, Includes Revised Galaxy Luminosities');
  assert.equal(paperA.journalRef, 'Astron.J.135:922-927,2008');
  assert.equal(paperA.doi, '10.1088/0004-6256/135/3/922');
  assert.equal(paperA.doiUrl, 'https://doi.org/10.1088/0004-6256/135/3/922');
  assert.equal(paperA.abstractUrl, 'https://arxiv.org/abs/0710.5765v2');
  assert.equal(paperA.pdfUrl, 'https://arxiv.org/pdf/0710.5765v2');
  assert.equal(paperA.authors.length, 2);
  assert.equal(paperA.authors[1].name, 'M. T. Murphy');
  assert.deepEqual(paperA.authors[1].affiliations, ['IoA', 'Swinburne']);
  assert.ok(paperA.published.includes('2007'));
  assert.ok(paperA.updated.includes('2008'));

  assert.ok(paperB);
  assert.equal(paperB.primaryCategory, 'quant-ph');
  assert.equal(paperB.categories.length, 3);
  assert.deepEqual(paperB.categories.map((category) => category.term), ['quant-ph', 'cs.DS', 'cs.LG']);
  assert.equal(paperB.authors.length, 3);
  assert.equal(paperB.authors[0].name, 'Ada Lovelace');
  assert.deepEqual(paperB.authors[0].affiliations, []);
  assert.equal(paperB.doi, '');
  assert.equal(paperB.doiUrl, '');
});

test('mapPaper handles sparse entries and derives arxiv ids', () => {
  const sparse = wrapFeed({
    entries: `
<entry>
  <id>http://arxiv.org/abs/cond-mat/0207270</id>
  <title>Ordered skyrmion states</title>
  <link href="https://arxiv.org/abs/cond-mat/0207270v3" rel="alternate" type="text/html"/>
  <link href="https://arxiv.org/pdf/cond-mat/0207270v3" rel="related" type="application/pdf" title="pdf"/>
  <summary>Abstract text.</summary>
  <published>2002-07-27T00:00:00Z</published>
  <updated>2003-01-01T00:00:00Z</updated>
</entry>`,
    totalResults: 1,
    itemsPerPage: 1,
  });
  const { papers, meta } = _test.parseFeedResponse(sparse, 200);
  assert.equal(meta.feedId, 'http://arxiv.org/api/mock-feed');
  assert.equal(papers.length, 1);
  const paper = papers[0];
  assert.equal(paper.arxivId, 'cond-mat/0207270v3');
  assert.equal(paper.title, 'Ordered skyrmion states');
  assert.equal(paper.authors.length, 0);
  assert.equal(paper.categories.length, 0);
  assert.equal(paper.primaryCategory, '');
  assert.equal(paper.comment, '');
  assert.equal(paper.doi, '');
});

test('arxivIdFromUrl strips the abstract host', () => {
  assert.equal(_test.arxivIdFromUrl('https://arxiv.org/abs/0710.5765v2'), '0710.5765v2');
  assert.equal(_test.arxivIdFromUrl('http://arxiv.org/abs/hep-ex/0307015'), 'hep-ex/0307015');
  assert.equal(_test.arxivIdFromUrl('0710.5765'), '0710.5765');
});

// ---------------------------------------------------------------------------
// Request construction
// ---------------------------------------------------------------------------

test('buildQueryParams applies defaults and validates ranges', () => {
  const defaults = _test.buildQueryParams({ searchQuery: 'all:electron' });
  assert.equal(defaults.start, '0');
  assert.equal(defaults.max_results, '10');
  assert.equal(defaults.sortBy, 'relevance');
  assert.equal(defaults.sortOrder, 'descending');
  assert.equal(defaults.id_list, '');

  const explicit = _test.buildQueryParams({
    searchQuery: 'all:electron',
    start: 20,
    maxResults: 50,
    sortBy: 'submittedDate',
    sortOrder: 'ascending',
  });
  assert.equal(explicit.start, '20');
  assert.equal(explicit.max_results, '50');
  assert.equal(explicit.sortBy, 'submittedDate');
  assert.equal(explicit.sortOrder, 'ascending');

  assert.throws(() => _test.buildQueryParams({ searchQuery: 'x', start: -1 }), /INVALID_ARGUMENT/);
  assert.throws(() => _test.buildQueryParams({ searchQuery: 'x', sortBy: 'bogus' }), /INVALID_ARGUMENT/);
  assert.throws(() => _test.buildQueryParams({ searchQuery: 'x', sortOrder: 'sideways' }), /INVALID_ARGUMENT/);
  assert.throws(() => _test.buildQueryParams({ searchQuery: 'x', maxResults: 5000 }), /INVALID_ARGUMENT/);
});

test('buildQueryUrl produces an /api/query URL with the given parameters', () => {
  const url = new URL(_test.buildQueryUrl(
    { baseUrl: 'https://export.arxiv.org/' },
    { search_query: 'au:del_maestro AND ti:checkerboard', start: '0', max_results: '10', sortBy: 'relevance' },
  ));
  assert.equal(url.pathname, '/api/query');
  assert.equal(url.searchParams.get('search_query'), 'au:del_maestro AND ti:checkerboard');
  assert.equal(url.searchParams.get('start'), '0');
  assert.equal(url.searchParams.get('max_results'), '10');
  assert.equal(url.searchParams.get('sortBy'), 'relevance');
});

// ---------------------------------------------------------------------------
// Operations and validation
// ---------------------------------------------------------------------------

test('searchPapers requires a non-empty searchQuery', async () => {
  await expectLegacy(() => searchPapers(baseConfig, {}), 'INVALID_ARGUMENT');
  await expectLegacy(() => searchPapers(baseConfig, { searchQuery: '   ' }), 'INVALID_ARGUMENT');
});

test('searchPapers handles an empty result set', async () => {
  const result = await searchPapers(baseConfig, { searchQuery: 'NO_RESULTS' });
  assert.equal(result.papers.length, 0);
  assert.equal(result.meta.totalResults, 0);
});

test('listPapers returns papers and reports missing ids', async () => {
  const result = await listPapers(baseConfig, ['0710.5765', '2609.04165', 'hep-ex/0307015', '9999.99999']);
  assert.deepEqual(
    result.papers.map((paper) => paper.arxivId).sort(),
    ['0710.5765v2', '2609.04165v1', 'hep-ex/0307015v1'],
  );
  assert.deepEqual(result.missingIds, ['9999.99999']);
});

test('listPapers requires at least one id', async () => {
  await expectLegacy(() => listPapers(baseConfig, []), 'INVALID_ARGUMENT');
  await expectLegacy(() => listPapers(baseConfig, ['  ']), 'INVALID_ARGUMENT');
});

test('getPaper returns the latest version for a bare id', async () => {
  const paper = await getPaper(baseConfig, '0710.5765');
  assert.equal(paper.arxivId, '0710.5765v2');
});

test('getPaper maps unknown ids to NOT_FOUND and blank ids to INVALID_ARGUMENT', async () => {
  const err = await expectLegacy(() => getPaper(baseConfig, '9999.99999'), 'NOT_FOUND');
  assert.match(err.message, /9999\.99999/);
  await expectLegacy(() => getPaper(baseConfig, ''), 'INVALID_ARGUMENT');
});

// ---------------------------------------------------------------------------
// Handler wiring
// ---------------------------------------------------------------------------

test('handlers read request and config from ctx', async () => {
  const search = await handlers[METHODS.SEARCH_PAPERS]({
    config: baseConfig,
    request: { searchQuery: 'all:electron', maxResults: 5 },
  });
  assert.equal(search.papers.length, 2);

  const got = await handlers[METHODS.GET_PAPER]({
    config: baseConfig,
    request: { id: '2609.04165' },
  });
  assert.equal(got.paper.arxivId, '2609.04165v1');

  const listed = await handlers[METHODS.LIST_PAPERS]({
    config: baseConfig,
    request: { ids: ['0710.5765', 'hep-ex/0307015'] },
  });
  assert.equal(listed.papers.length, 2);
  assert.equal(listed.missingIds.length, 0);
});

// ---------------------------------------------------------------------------
// Upstream error mapping
// ---------------------------------------------------------------------------

test('maps arXiv Atom error feeds to INVALID_ARGUMENT', async () => {
  const err = await expectLegacy(
    () => searchPapers(baseConfig, { searchQuery: 'ERRORFEED' }),
    'INVALID_ARGUMENT',
  );
  assert.match(err.message, /sortBy must be in/);
  await expectLegacy(
    () => searchPapers(baseConfig, { searchQuery: 'FAIL400' }),
    'INVALID_ARGUMENT',
  );
});

test('parseFeedResponse turns error entries into INVALID_ARGUMENT', () => {
  const feed = wrapFeed({
    entries: `
<entry>
  <id>http://arxiv.org/api/errors</id>
  <title>Error</title>
  <summary>incorrect id format for 1234.12345</summary>
  <author>
    <name>arXiv api core</name>
  </author>
</entry>`,
    totalResults: 1,
    itemsPerPage: 1,
  });
  assert.throws(
    () => _test.parseFeedResponse(feed, 200),
    (e) => e instanceof GrpcError
      && e.legacyCode === 'INVALID_ARGUMENT'
      && /incorrect id format/.test(e.message),
  );
});

test('maps upstream HTTP failures to gRPC codes', async () => {
  await expectLegacy(() => searchPapers(baseConfig, { searchQuery: 'FAIL500' }), 'UNAVAILABLE');
  await expectLegacy(() => searchPapers(baseConfig, { searchQuery: 'FORBIDDEN' }), 'PERMISSION_DENIED');
  await expectLegacy(() => searchPapers(baseConfig, { searchQuery: 'RATELIMIT' }), 'UNAVAILABLE');
});

test('maps malformed and non-Atom payloads to UNAVAILABLE', async () => {
  await expectLegacy(() => searchPapers(baseConfig, { searchQuery: 'BADXML' }), 'UNAVAILABLE');
  await expectLegacy(() => searchPapers(baseConfig, { searchQuery: 'MALFORMEDXML' }), 'UNAVAILABLE');
});

test('maps network failures to UNAVAILABLE without leaking internals', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('getaddrinfo ENOTFOUND internal.arxiv.lan'); };
  try {
    const err = await expectLegacy(() => getPaper(baseConfig, '0710.5765'), 'UNAVAILABLE');
    assert.doesNotMatch(err.message, /internal\.arxiv\.lan|ENOTFOUND/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('maps fetch timeouts to UNAVAILABLE', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });
  try {
    const err = await expectLegacy(
      () => searchPapers({ ...baseConfig, timeoutMs: 1 }, { searchQuery: 'x' }),
      'UNAVAILABLE',
    );
    assert.match(err.message, /timed out/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Config handling
// ---------------------------------------------------------------------------

test('uses the configured base URL and rejects unsafe schemes', async () => {
  const seen = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    return { status: 200, text: async () => wrapFeed({ entries: ENTRY_A, totalResults: 1, itemsPerPage: 1 }) };
  };
  try {
    await searchPapers({ baseUrl: 'http://127.0.0.1:1234', timeoutMs: 100 }, { searchQuery: 'all:electron' });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.ok(seen[0].startsWith('http://127.0.0.1:1234/api/query?'), seen[0]);
  assert.ok(seen[0].includes('search_query='), seen[0]);
  assert.ok(seen[0].includes('max_results='), seen[0]);

  assert.throws(() => _test.resolveBaseUrl({ baseUrl: 'file:///etc/passwd' }), /INVALID_ARGUMENT/);
  assert.throws(() => _test.resolveBaseUrl({ baseUrl: 'not a url' }), /INVALID_ARGUMENT/);
});
