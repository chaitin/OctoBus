// arxiv__api — arXiv API wrapper for OctoBus.
//
// Calls the public arXiv query interface
//   GET https://export.arxiv.org/api/query?search_query=...&id_list=...&start=...
// and maps the Atom 1.0 XML feed back to plain proto-shaped objects.
//
// References:
//   - https://info.arxiv.org/help/api/basics.html
//   - https://info.arxiv.org/help/api/user-manual.html

import { GrpcError, grpcStatus } from '@chaitin-ai/octobus-sdk';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

// ---------------------------------------------------------------------------
// Method table
// ---------------------------------------------------------------------------

const PREFIX = 'arxiv.v1.ArxivService';

export const METHODS = {
  SEARCH_PAPERS: `${PREFIX}/SearchPapers`,
  GET_PAPER: `${PREFIX}/GetPaper`,
  LIST_PAPERS: `${PREFIX}/ListPapers`,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = 'https://export.arxiv.org';
// arXiv legacy API Terms of Use: at most one request every three seconds and a
// single connection at a time across all machines under the caller's control.
// This package enforces that inside one running instance (see requestGate);
// run a single instance per arXiv account/network to keep the guarantee.
const DEFAULT_MIN_REQUEST_INTERVAL_MS = 3000;
// Kept comfortably below a client's gRPC deadline; large arXiv result pages
// can take a while, so this is decoupled from the old on-demand 30s limit.
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_USER_AGENT = 'octobus-arxiv-api/0.1 (https://arxiv.org/help/api)';
const DEFAULT_MAX_RESULTS = 10;
// OctoBus service-level cap. arXiv itself hard-limits max_results at 30000 in
// slices of at most 2000; we deliberately stay inside the documented slice.
const MAX_MAX_RESULTS = 2000;
// Guard rails so a caller cannot build unbounded /api/query URLs via id_list.
const MAX_IDS_PER_REQUEST = 2000;
const MAX_ID_LENGTH = 128;
const MAX_ID_LIST_LENGTH = 20000;
// requestGate admission/backpressure bounds. These are internal safety limits
// (not declared in config.schema) so the public arXiv endpoint always runs
// with conservative defaults; they can be lowered from direct code/tests.
const DEFAULT_MAX_PENDING_REQUESTS = 8;
const DEFAULT_QUEUE_TIMEOUT_MS = 30000;

const SORT_BY_VALUES = ['relevance', 'lastUpdatedDate', 'submittedDate'];
const SORT_ORDER_VALUES = ['ascending', 'descending'];

// arXiv returns errors as normal Atom feeds (HTTP 200) whose single entry has
// the title "Error" and a human readable <summary>. It can also surface them
// as HTTP 400/500 responses.
const ERROR_ENTRY_TITLE = 'error';

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

const grpcCodeFor = (code) => ({
  INVALID_ARGUMENT: grpcStatus.INVALID_ARGUMENT,
  NOT_FOUND: grpcStatus.NOT_FOUND,
  PERMISSION_DENIED: grpcStatus.PERMISSION_DENIED,
  RESOURCE_EXHAUSTED: grpcStatus.RESOURCE_EXHAUSTED,
  UNAVAILABLE: grpcStatus.UNAVAILABLE,
})[code] ?? grpcStatus.UNKNOWN;

const errorWithCode = (code, message) => {
  const err = new GrpcError(grpcCodeFor(code), `${code}: ${message}`);
  err.legacyCode = code;
  return err;
};

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const asString = (value) => String(value ?? '').trim();

const asList = (value) => {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
};

const attr = (element, name) => (element && element[`@_${name}`] !== undefined)
  ? element[`@_${name}`]
  : undefined;

const unwrapScalar = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && hasOwn(value, 'value')) return unwrapScalar(value.value);
  return value;
};

const cleanText = (value) => asString(unwrapScalar(value));

const toInt = (value, fallback) => {
  const n = Number(unwrapScalar(value));
  return Number.isInteger(n) ? n : fallback;
};

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

const resolveBaseUrl = (config = {}) => {
  const raw = asString(config.baseUrl) || DEFAULT_BASE_URL;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw errorWithCode('INVALID_ARGUMENT', 'baseUrl must be a valid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw errorWithCode('INVALID_ARGUMENT', 'baseUrl must use http or https');
  }
  return raw.replace(/\/+$/, '');
};

const resolveConfig = (config = {}) => {
  const rawTimeout = toInt(firstDefined(config.timeoutMs, DEFAULT_TIMEOUT_MS), DEFAULT_TIMEOUT_MS);
  const rawInterval = toInt(firstDefined(config.minRequestIntervalMs, DEFAULT_MIN_REQUEST_INTERVAL_MS), DEFAULT_MIN_REQUEST_INTERVAL_MS);
  return {
    baseUrl: resolveBaseUrl(config),
    // Non-positive timeouts abort immediately; treat them as unset.
    timeoutMs: rawTimeout > 0 ? rawTimeout : DEFAULT_TIMEOUT_MS,
    userAgent: cleanText(config.userAgent) || DEFAULT_USER_AGENT,
    // Tests / isolated mirrors may relax the gap (0 disables it). The arXiv
    // Terms of Use require >= 3000 against the public endpoint.
    minRequestIntervalMs: rawInterval >= 0 ? rawInterval : DEFAULT_MIN_REQUEST_INTERVAL_MS,
  };
};

// ---------------------------------------------------------------------------
// Query parameter validation / construction
// ---------------------------------------------------------------------------

const enumValue = (value, field, allowed, fallback) => {
  const text = asString(value);
  if (!text) return fallback;
  if (!allowed.includes(text)) {
    throw errorWithCode('INVALID_ARGUMENT', `${field} must be one of ${allowed.join(', ')}`);
  }
  return text;
};

const integerParam = (value, field, { min, max, fallback }) => {
  const raw = unwrapScalar(value);
  const n = raw === undefined || raw === null || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(n)) {
    throw errorWithCode('INVALID_ARGUMENT', `${field} must be an integer`);
  }
  if (min !== undefined && n < min) {
    throw errorWithCode('INVALID_ARGUMENT', `${field} must be >= ${min}`);
  }
  if (max !== undefined && n > max) {
    throw errorWithCode('INVALID_ARGUMENT', `${field} must be <= ${max}`);
  }
  return n;
};

export const buildQueryParams = (request = {}) => {
  const searchQuery = asString(request.search_query ?? request.searchQuery);
  const start = integerParam(request.start, 'start', { min: 0, fallback: 0 });
  // maxResults == 0 means "not provided" (proto3 int32 default).
  const maxResults = integerParam(
    request.max_results ?? request.maxResults,
    'max_results',
    { min: 0, max: MAX_MAX_RESULTS, fallback: DEFAULT_MAX_RESULTS },
  ) || DEFAULT_MAX_RESULTS;
  const sortBy = enumValue(request.sort_by ?? request.sortBy, 'sortBy', SORT_BY_VALUES, 'relevance');
  const sortOrder = enumValue(request.sort_order ?? request.sortOrder, 'sortOrder', SORT_ORDER_VALUES, 'descending');

  return {
    search_query: searchQuery,
    id_list: asString(request.id_list ?? request.idList),
    start: String(start),
    max_results: String(maxResults),
    sortBy,
    sortOrder,
  };
};

export const buildQueryUrl = (config, params = {}) => {
  const url = new URL(`${resolveBaseUrl(config)}/api/query`);
  for (const [key, value] of Object.entries(params)) {
    const text = asString(value);
    if (!text) continue;
    url.searchParams.set(key, text);
  }
  return url.toString();
};

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Serialized upstream request gate
//
// The arXiv legacy API Terms of Use allow no more than one request every
// three seconds and only a single connection at a time. Every upstream call
// made by this process goes through requestGate, which serializes calls and
// enforces a minimum gap between the starts of consecutive requests. The gate
// only covers the process it runs in, so a single instance must be used
// against the public arXiv endpoint (see README for the deployment caveat).
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// -- bounded serial queue state -----------------------------------------------
// arXiv requires strictly serial requests spaced >= 3s apart, so upstream work
// cannot run concurrently. To avoid an unbounded backlog (head-of-line
// blocking, stale requests firing after their clients gave up) the gate:
//   * admits at most maxPendingRequests requests (active + queued) and fails
//     fast with RESOURCE_EXHAUSTED beyond that;
//   * abandons a request that is still queued after queueTimeoutMs and removes
//     it without ever touching the upstream API (client receives UNAVAILABLE).
// -----------------------------------------------------------------------------

const gateLimits = (config = {}) => {
  const interval = toInt(firstDefined(config.minRequestIntervalMs, DEFAULT_MIN_REQUEST_INTERVAL_MS), DEFAULT_MIN_REQUEST_INTERVAL_MS);
  const maxPending = toInt(firstDefined(config.maxPendingRequests, DEFAULT_MAX_PENDING_REQUESTS), DEFAULT_MAX_PENDING_REQUESTS);
  const queueTimeout = toInt(firstDefined(config.queueTimeoutMs, DEFAULT_QUEUE_TIMEOUT_MS), DEFAULT_QUEUE_TIMEOUT_MS);
  return {
    minIntervalMs: interval >= 0 ? interval : DEFAULT_MIN_REQUEST_INTERVAL_MS,
    maxPendingRequests: maxPending > 0 ? maxPending : DEFAULT_MAX_PENDING_REQUESTS,
    queueTimeoutMs: queueTimeout > 0 ? queueTimeout : DEFAULT_QUEUE_TIMEOUT_MS,
  };
};

let queued = [];
let activeCount = 0;
let lastRequestStartedAt = 0;
let workerRunning = false;

const abandonQueued = (entry, queueTimeoutMs) => {
  if (entry.abandoned) return;
  const index = queued.indexOf(entry);
  if (index === -1) return; // already dequeued and running
  queued.splice(index, 1);
  entry.abandoned = true;
  entry.reject(errorWithCode('UNAVAILABLE', `request timed out waiting in the upstream queue after ${queueTimeoutMs}ms`));
};

async function drainQueue() {
  if (workerRunning) return;
  workerRunning = true;
  try {
    while (queued.length > 0) {
      const entry = queued.shift();
      if (entry.abandoned) continue; // removed by its queue-timeout timer
      clearTimeout(entry.timer);
      // The entry is committed from here on: count it as in-flight so the
      // admission check never over-admits while it waits out its interval.
      activeCount += 1;
      try {
        const waitMs = Math.max(0, lastRequestStartedAt + entry.minIntervalMs - Date.now());
        if (waitMs > 0) await sleep(waitMs);
        lastRequestStartedAt = Date.now();
        const value = await entry.fn();
        entry.resolve(value);
      } catch (err) {
        entry.reject(err);
      } finally {
        activeCount -= 1;
      }
    }
  } finally {
    workerRunning = false;
    if (queued.length > 0) drainQueue(); // safety net for a late enqueue race
  }
}

export const requestGate = (config = {}, fn) => {
  const limits = gateLimits(config);
  // Admission control: fail fast instead of growing an unbounded backlog.
  if (activeCount + queued.length >= limits.maxPendingRequests) {
    return Promise.reject(errorWithCode('RESOURCE_EXHAUSTED',
      `upstream request queue is full (max ${limits.maxPendingRequests} pending); retry later`));
  }
  return new Promise((resolve, reject) => {
    const entry = {
      fn,
      resolve,
      reject,
      timer: null,
      abandoned: false,
      minIntervalMs: limits.minIntervalMs,
    };
    entry.timer = setTimeout(() => abandonQueued(entry, limits.queueTimeoutMs), limits.queueTimeoutMs);
    queued.push(entry);
    drainQueue();
  });
};

const extractFeedErrorDetail = (body) => {
  try {
    const feed = (typeof body === 'string' ? parser.parse(body) : body)?.feed;
    const entry = asList(feed?.entry)
      .find((item) => asString(item?.title).toLowerCase() === ERROR_ENTRY_TITLE);
    return entry ? sanitizeErrorSummary(entry.summary) : '';
  } catch {
    return '';
  }
};

const fetchAtomTextNow = async (config, params = {}) => {
  const { timeoutMs, userAgent } = resolveConfig(config);
  const url = buildQueryUrl(config, params);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1',
        'User-Agent': userAgent,
      },
    });
    const body = await res.text();

    if (res.status === 401 || res.status === 403) {
      throw errorWithCode('PERMISSION_DENIED', `arXiv API HTTP ${res.status}`);
    }
    if (res.status === 429) {
      throw errorWithCode('UNAVAILABLE', `arXiv API HTTP ${res.status} (rate limited)`);
    }
    if (res.status === 400) {
      // Bad request: arXiv normally describes the problem in an Atom error feed.
      const detail = extractFeedErrorDetail(body);
      throw errorWithCode('INVALID_ARGUMENT', detail ? `arXiv API HTTP 400: ${detail}` : 'arXiv API HTTP 400');
    }
    if (res.status >= 500) {
      throw errorWithCode('UNAVAILABLE', `arXiv API HTTP ${res.status}`);
    }
    if (res.status !== 200) {
      throw errorWithCode('UNAVAILABLE', `arXiv API HTTP ${res.status}`);
    }
    return body;
  } catch (err) {
    if (err instanceof GrpcError) throw err;
    if (err?.name === 'AbortError') {
      throw errorWithCode('UNAVAILABLE', `arXiv API request timed out after ${timeoutMs}ms`);
    }
    // Do not leak internal network details; surface a stable message instead.
    throw errorWithCode('UNAVAILABLE', 'arXiv API request failed');
  } finally {
    clearTimeout(timer);
  }
};

// Rate-limited entry point: every upstream request is queued behind the gate.
const fetchAtomText = (config, params = {}) => requestGate(config, () => fetchAtomTextNow(config, params));

// ---------------------------------------------------------------------------
// Atom feed parsing / response mapping
// ---------------------------------------------------------------------------

const sanitizeErrorSummary = (message) => asString(message).replace(/\s+/g, ' ');

const throwAtomErrorFeed = (feed, httpStatus = 200) => {
  const entries = asList(feed?.entry);
  const errorEntry = entries.find((entry) => asString(entry?.title).toLowerCase() === ERROR_ENTRY_TITLE);
  if (!errorEntry) {
    throw errorWithCode('UNAVAILABLE', `arXiv API returned an unusable response (HTTP ${httpStatus})`);
  }
  const detail = sanitizeErrorSummary(errorEntry.summary) || 'arXiv API error';
  const isServerSide = httpStatus >= 500 || /internal error|overloaded|unable to complete/.test(detail.toLowerCase());
  throw errorWithCode(isServerSide ? 'UNAVAILABLE' : 'INVALID_ARGUMENT', detail);
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
});

// Accepts either a raw XML string (validates + parses it) or an already parsed feed.
export const parseFeedResponse = (body, httpStatus = 200) => {
  let feed;
  try {
    if (typeof body === 'string') {
      const valid = XMLValidator.validate(body);
      if (valid !== true) throw errorWithCode('UNAVAILABLE', 'arXiv API returned invalid XML');
      feed = parser.parse(body)?.feed;
    } else {
      feed = body?.feed;
    }
  } catch (err) {
    if (err instanceof GrpcError) throw err;
    throw errorWithCode('UNAVAILABLE', 'arXiv API returned invalid XML');
  }
  if (!feed) throw errorWithCode('UNAVAILABLE', 'arXiv API response has no feed element');

  const entries = asList(feed.entry);
  if (entries.some((entry) => asString(entry?.title).toLowerCase() === ERROR_ENTRY_TITLE)) {
    throwAtomErrorFeed(feed, httpStatus);
  }

  return {
    meta: mapFeedMeta(feed),
    papers: entries.map(mapPaper),
  };
};

const mapFeedMeta = (feed) => {
  const links = asList(feed.link);
  const selfLink = links.find((link) => attr(link, 'rel') === 'self') ?? links[0];
  return {
    totalResults: toInt(feed.totalResults, 0),
    startIndex: toInt(feed.startIndex, 0),
    itemsPerPage: toInt(feed.itemsPerPage, 0),
    feedId: cleanText(feed.id),
    feedTitle: cleanText(feed.title),
    updated: cleanText(feed.updated),
    selfLink: attr(selfLink, 'href') ? String(attr(selfLink, 'href')) : '',
  };
};

// Strips "http(s)://arxiv.org/abs/" from an abstract URL to yield the arXiv id.
export const arxivIdFromUrl = (url) => {
  const text = asString(url);
  const match = text.match(/^https?:\/\/arxiv\.org\/abs\/(.+)$/i);
  return match ? match[1] : text;
};

export const mapPaper = (entry = {}) => {
  const links = asList(entry.link);
  const linkWith = (rel, title) => links.find((link) => attr(link, 'rel') === rel && attr(link, 'title') === title);

  const abstractUrl = cleanText(attr(links.find((link) => attr(link, 'rel') === 'alternate'), 'href')) || cleanText(entry.id);
  const pdfUrl = cleanText(attr(linkWith('related', 'pdf'), 'href'));
  const doiUrl = cleanText(attr(linkWith('related', 'doi'), 'href'));

  const authors = asList(entry.author).map((author) => ({
    name: cleanText(author?.name),
    affiliations: asList(author?.affiliation).map(cleanText).filter(Boolean),
  }));

  const categories = asList(entry.category)
    .map((category) => ({
      term: cleanText(attr(category, 'term')),
      scheme: cleanText(attr(category, 'scheme')),
    }))
    .filter((category) => category.term);

  let doi = cleanText(entry.doi);
  if (!doi && doiUrl) doi = doiUrl.replace(/^https?:\/\/doi\.org\//i, '');

  return {
    id: abstractUrl,
    arxivId: arxivIdFromUrl(abstractUrl),
    title: cleanText(entry.title),
    summary: cleanText(entry.summary),
    published: cleanText(entry.published),
    updated: cleanText(entry.updated),
    authors,
    comment: cleanText(entry.comment),
    journalRef: cleanText(entry.journal_ref),
    doi,
    primaryCategory: cleanText(attr(entry.primary_category, 'term')),
    categories,
    abstractUrl,
    pdfUrl,
    doiUrl,
  };
};

// ---------------------------------------------------------------------------
// Public operations
// ---------------------------------------------------------------------------

// Runs an arXiv query and returns { meta, papers }.
export const queryArxiv = async (config, params) => {
  const body = await fetchAtomText(config, params);
  return parseFeedResponse(body, 200);
};

export const searchPapers = async (config, request = {}) => {
  const params = buildQueryParams(request);
  if (!params.search_query) {
    throw errorWithCode('INVALID_ARGUMENT', 'searchQuery is required');
  }
  params.id_list = '';
  const { meta, papers } = await queryArxiv(config, params);
  return { meta, papers };
};

// Splits an arXiv id into its bare id and optional version suffix. A bare id
// (no trailing vN) means "latest version"; an explicit vN requests that exact
// historical version (see arXiv API User's Manual §5.1.1).
export const splitId = (id) => {
  const text = asString(id);
  const match = text.match(/^(.*?)(v\d+)$/i);
  return match
    ? { requested: text, base: match[1], version: match[2].toLowerCase() }
    : { requested: text, base: text, version: null };
};

const validateIds = (rawIds) => {
  const cleanIds = asList(rawIds)
    .map(cleanText)
    .filter(Boolean);
  if (cleanIds.length === 0) {
    throw errorWithCode('INVALID_ARGUMENT', 'at least one id is required');
  }
  if (cleanIds.length > MAX_IDS_PER_REQUEST) {
    throw errorWithCode('INVALID_ARGUMENT', `at most ${MAX_IDS_PER_REQUEST} ids per request`);
  }
  const tooLong = cleanIds.find((id) => id.length > MAX_ID_LENGTH);
  if (tooLong) {
    throw errorWithCode('INVALID_ARGUMENT', `id is too long (max ${MAX_ID_LENGTH} characters): ${tooLong.slice(0, 64)}`);
  }
  const joined = cleanIds.join(',');
  if (joined.length > MAX_ID_LIST_LENGTH) {
    throw errorWithCode('INVALID_ARGUMENT', `combined id_list is too long (max ${MAX_ID_LIST_LENGTH} characters)`);
  }
  return { cleanIds, joined };
};

// Fetches several papers by arXiv id and reports which requested ids could
// not be found. Bare ids match the returned (latest) version; versioned ids
// must match the exact returned version.
export const listPapers = async (config, ids = []) => {
  const { cleanIds, joined } = validateIds(ids);

  const { papers } = await queryArxiv(config, {
    search_query: '',
    id_list: joined,
    start: '0',
    max_results: String(cleanIds.length),
  });

  const returnedFull = new Set(papers.map((paper) => asString(paper.arxivId).toLowerCase()));
  const returnedBase = new Set(papers.map((paper) => splitId(paper.arxivId).base.toLowerCase()));
  const missingIds = cleanIds.filter((id) => {
    const { requested, base, version } = splitId(id);
    return version
      ? !returnedFull.has(requested.toLowerCase())
      : !returnedBase.has(base.toLowerCase());
  });

  return { papers, missingIds };
};

export const getPaper = async (config, id) => {
  const text = cleanText(id);
  if (!text) throw errorWithCode('INVALID_ARGUMENT', 'id is required');
  const { papers } = await listPapers(config, [text]);
  if (papers.length === 0) {
    throw errorWithCode('NOT_FOUND', `paper not found: ${text}`);
  }
  return papers[0];
};

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const resolveCtx = (ctx = {}) => ({
  config: ctx.config ?? {},
  req: ctx.request ?? ctx.req ?? {},
  meta: ctx.meta ?? {},
});

export const handlers = {
  [METHODS.SEARCH_PAPERS]: async (ctx) => {
    const { config, req } = resolveCtx(ctx);
    return searchPapers(config, req);
  },
  [METHODS.GET_PAPER]: async (ctx) => {
    const { config, req } = resolveCtx(ctx);
    const paper = await getPaper(config, req.id);
    return { paper };
  },
  [METHODS.LIST_PAPERS]: async (ctx) => {
    const { config, req } = resolveCtx(ctx);
    return listPapers(config, req.ids);
  },
};

export const _test = {
  arxivIdFromUrl,
  asList,
  attr,
  buildQueryParams,
  buildQueryUrl,
  cleanText,
  errorWithCode,
  extractFeedErrorDetail,
  fetchAtomText,
  grpcCodeFor,
  integerParam,
  mapFeedMeta,
  mapPaper,
  parseFeedResponse,
  requestGate,
  resolveBaseUrl,
  resolveConfig,
  splitId,
  toInt,
  validateIds,
};
