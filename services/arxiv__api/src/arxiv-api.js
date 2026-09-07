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
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_USER_AGENT = 'octobus-arxiv-api/0.1 (https://arxiv.org/help/api)';
const DEFAULT_MAX_RESULTS = 10;
const MAX_MAX_RESULTS = 2000;

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

const resolveConfig = (config = {}) => ({
  baseUrl: resolveBaseUrl(config),
  timeoutMs: toInt(firstDefined(config.timeoutMs, DEFAULT_TIMEOUT_MS), DEFAULT_TIMEOUT_MS),
  userAgent: cleanText(config.userAgent) || DEFAULT_USER_AGENT,
});

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

const fetchAtomText = async (config, params = {}) => {
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

// Splits arXiv ids and matches returned papers back to the requested ids,
// reporting ids (without their version suffix) that could not be found.
export const listPapers = async (config, ids = []) => {
  const cleanIds = asList(ids)
    .map(cleanText)
    .filter(Boolean);
  if (cleanIds.length === 0) {
    throw errorWithCode('INVALID_ARGUMENT', 'at least one id is required');
  }

  const { papers } = await queryArxiv(config, {
    search_query: '',
    id_list: cleanIds.join(','),
    start: '0',
    max_results: String(cleanIds.length),
  });

  const stripVersion = (id) => asString(id).replace(/v\d+$/i, '');
  const found = new Set(papers.map((paper) => stripVersion(paper.arxivId)));
  const requested = new Set(cleanIds.map(stripVersion));
  const missingIds = [...requested].filter((id) => !found.has(id));

  return { papers, missingIds };
};

export const getPaper = async (config, id) => {
  const text = cleanText(id);
  if (!text) throw errorWithCode('INVALID_ARGUMENT', 'id is required');
  const { papers, missingIds } = await listPapers(config, [text]);
  if (papers.length === 0 || missingIds.includes(text.replace(/v\d+$/i, ''))) {
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
  resolveBaseUrl,
  resolveConfig,
  toInt,
};
