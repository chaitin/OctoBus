/**
 * TypeRegistry — Default parameter configuration for five memory types
 *
 * Each memory type has different TTL, dedup window, confidence, capacity limit,
 * and eviction policy. Remember calls use defaults from this registry when
 * parameters are unspecified. To add a new memory type, simply add an entry
 * here — no code changes needed.
 */

const SECONDS = {
  MINUTE: 60,
  HOUR: 3600,
  DAY: 86400,
  WEEK: 7 * 86400,
  MONTH: 30 * 86400,
};

const TYPE_REGISTRY = {
  entity_cache: {
    defaultTTL: SECONDS.WEEK,
    dedupWindow: 0,
    defaultConfidence: 1.0,
    maxEntries: 200,
    evictPolicy: 'lru',
    description: 'Query result cache (CRM IDs, project details, etc. — expensive query results)',
    label: 'Entity Cache',
  },
  action_log: {
    defaultTTL: SECONDS.WEEK,
    dedupWindow: SECONDS.DAY,
    defaultConfidence: 1.0,
    maxEntries: 1000,
    evictPolicy: 'oldest',
    description: 'Action log (todo creation, kanban writes, etc. — write operation records for idempotent dedup)',
    label: 'Action Log',
  },
  user_correction: {
    defaultTTL: 0,
    dedupWindow: 0,
    defaultConfidence: 0.9,
    maxEntries: 100,
    evictPolicy: 'compress',
    description: 'User correction (user-initiated fixes to agent behavior — highest-value memory)',
    label: 'User Correction',
  },
  commitment: {
    defaultTTL: SECONDS.MONTH,
    dedupWindow: 0,
    defaultConfidence: 1.0,
    maxEntries: 100,
    evictPolicy: 'lru',
    description: 'Commitment (future tasks the user mentioned they will do)',
    label: 'Commitment',
  },
  session_summary: {
    defaultTTL: SECONDS.MONTH,
    dedupWindow: 0,
    defaultConfidence: 1.0,
    maxEntries: 50,
    evictPolicy: 'oldest',
    description: 'Session summary (key decisions and pending items at the end of each session)',
    label: 'Session Summary',
  },
};

/**
 * Resolve Remember request parameters, filling in defaults
 * @param {object} request - { key, value, type, ttl_seconds, dedup_window_sec, confidence }
 * @returns {object} resolved - complete parameters with defaults filled in
 */
export function resolve(request) {
  const type = request.type || 'entity_cache';
  const registry = TYPE_REGISTRY[type];

  if (!registry) {
    throw new Error(`Unknown memory type "${type}", available types: ${Object.keys(TYPE_REGISTRY).join(', ')}`);
  }

  const ttlSeconds = request.ttl_seconds === -1
    ? 0  // -1 means never expire
    : (request.ttl_seconds || registry.defaultTTL);

  return {
    key: request.key,
    value: request.value,
    type,
    ttlSeconds,
    dedupWindowSec: request.dedup_window_sec || registry.dedupWindow,
    confidence: request.confidence || registry.defaultConfidence,
    maxEntries: registry.maxEntries,
    evictPolicy: registry.evictPolicy,
    protected: (request.confidence || registry.defaultConfidence) >= 0.9 && ttlSeconds === 0,
  };
}

/**
 * Get the registry config for a specific type
 */
export function getTypeConfig(type) {
  return TYPE_REGISTRY[type] || null;
}

/**
 * List all available types
 */
export function listTypes() {
  return Object.entries(TYPE_REGISTRY).map(([type, config]) => ({
    type,
    ...config,
  }));
}

export default TYPE_REGISTRY;
