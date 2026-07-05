/**
 * DistillationEngine — Memory Distillation Engine
 *
 * Core value: makes memory more than just "store and retrieve" —
 * it continuously compresses and refines.
 * Three levels of distillation:
 *   1. action_log → session_summary (periodic summary, ~10:1 compression)
 *   2. session_summary → monthly_summary (monthly rollup, ~10:1 compression)
 *   3. user_correction pattern extraction (multiple corrections for same key → upgrade to permanent preference)
 *
 * The distillation engine is driven by deterministic rules, not LLM.
 * It is a "clever tool", not an agent.
 */

export class DistillationEngine {
  /**
   * @param {import('./memory-engine.js').MemoryEngine} memoryEngine
   * @param {object} opts
   * @param {number} opts.summaryWindowDays - action_log periodic summary window (default 7 days)
   * @param {number} opts.monthlyWindowDays - session_summary monthly rollup window (default 30 days)
   * @param {number} opts.correctionThreshold - Number of corrections for same key to trigger upgrade (default 3)
   */
  constructor(memoryEngine, opts = {}) {
    this.engine = memoryEngine;
    this.summaryWindowDays = opts.summaryWindowDays || 7;
    this.monthlyWindowDays = opts.monthlyWindowDays || 30;
    this.correctionThreshold = opts.correctionThreshold || 3;

    // Distillation statistics
    this._stats = {
      totalRuns: 0,
      lastRunAt: null,
      actionLogCompressed: 0,
      sessionSummaryCompressed: 0,
      correctionsUpgraded: 0,
      errors: 0,
    };
  }

  /**
   * Run a full distillation pass (all types)
   * @returns {object} { success, summary, error }
   */
  async distill() {
    this._stats.totalRuns++;
    this._stats.lastRunAt = new Date().toISOString();

    const summary = {
      actionLog: null,
      sessionSummary: null,
      userCorrection: null,
    };

    try {
      // 1. action_log periodic summary
      summary.actionLog = await this._distillActionLogs();

      // 2. session_summary monthly rollup
      summary.sessionSummary = await this._distillSessionSummaries();

      // 3. user_correction pattern extraction
      summary.userCorrection = await this._distillUserCorrections();

      return { success: true, summary, error: '' };
    } catch (err) {
      this._stats.errors++;
      return { success: false, summary, error: err.message };
    }
  }

  /**
   * Get distillation statistics
   */
  getStats() {
    return { ...this._stats };
  }

  // ─── 1. Action Log Periodic Summary ───

  /**
   * Compress action_log entries within 7 days into 1 session_summary
   * @returns {object} { compressed, created, deleted }
   */
  async _distillActionLogs() {
    const now = new Date();
    const windowMs = this.summaryWindowDays * 86400 * 1000;
    const cutoff = new Date(now.getTime() - windowMs);

    // Collect action_log entries within the window
    const typeEntries = this.engine.index.getEntriesByType('action_log');
    const candidates = [];
    for (const [fullKey, entry] of typeEntries) {
      const created = new Date(entry.createdAt);
      if (created >= cutoff && created < now) {
        candidates.push({ fullKey, entry });
      }
    }

    if (candidates.length < 3) {
      // Too few, not worth compressing
      return { compressed: 0, created: 0, deleted: 0, reason: 'too_few_entries' };
    }

    // Analyze action_logs: extract patterns
    const analysis = this._analyzeActionLogs(candidates);

    // Build summary
    const summaryValue = JSON.stringify({
      source: 'distillation:action_log',
      period: {
        from: cutoff.toISOString(),
        to: now.toISOString(),
      },
      totalActions: candidates.length,
      topActions: analysis.topActions,
      topEntities: analysis.topEntities,
      frequency: analysis.frequency,
      patterns: analysis.patterns,
    });

    // Write session_summary
    const weekLabel = `${cutoff.toISOString().slice(0, 10)}_to_${now.toISOString().slice(0, 10)}`;
    const writeResult = await this.engine.remember({
      key: `distilled:action_log:${weekLabel}`,
      value: summaryValue,
      type: 'session_summary',
      ttl_seconds: 30 * 86400,  // 30 days
      confidence: 1.0,
    });

    let deletedCount = 0;
    if (writeResult.success) {
      // Delete compressed action_log entries
      for (const { fullKey } of candidates) {
        const entry = this.engine.index.delete(fullKey);
        if (entry) deletedCount++;
      }
      // Persist action_log
      await this.engine._persistType('action_log');
      // Persist session_summary (since a new entry was just written)
      await this.engine._persistType('session_summary');
    }

    this._stats.actionLogCompressed += deletedCount;

    return {
      compressed: candidates.length,
      created: writeResult.success ? 1 : 0,
      deleted: deletedCount,
    };
  }

  /**
   * Analyze action_log entries and extract patterns
   */
  _analyzeActionLogs(candidates) {
    const actionCounts = new Map();   // action → count
    const entityCounts = new Map();   // entity → count
    const dailyCounts = new Map();    // date → count
    const patterns = [];

    for (const { entry } of candidates) {
      // Extract action and entity from key
      // Key format: "action:<action_type>:<entity>:<date>" or similar structure
      const originalKey = entry._originalKey || '';
      const parts = originalKey.split(':');
      const action = parts[0] || 'unknown';
      const entity = parts[1] || 'unknown';

      // Count action frequency
      actionCounts.set(action, (actionCounts.get(action) || 0) + 1);

      // Count entity frequency
      entityCounts.set(entity, (entityCounts.get(entity) || 0) + 1);

      // Count daily frequency
      const date = entry.createdAt.slice(0, 10);
      dailyCounts.set(date, (dailyCounts.get(date) || 0) + 1);

      // Parse value to extract extra info
      try {
        const val = typeof entry.value === 'string' ? JSON.parse(entry.value) : entry.value;
        if (val && typeof val === 'object') {
          // Record success/failure
          if (val.success === false) {
            patterns.push(`Failed action: ${action}(${entity})`);
          }
        }
      } catch {
        // Value is not JSON, skip
      }
    }

    // Top 5 actions
    const topActions = [...actionCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([action, count]) => ({ action, count }));

    // Top 5 entities
    const topEntities = [...entityCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([entity, count]) => ({ entity, count }));

    // Frequency distribution
    const dailyArr = [...dailyCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const avgPerDay = candidates.length / Math.max(dailyArr.length, 1);
    const frequency = {
      avgPerDay: Math.round(avgPerDay * 10) / 10,
      activeDays: dailyArr.length,
      totalDays: this.summaryWindowDays,
    };

    // Pattern detection
    const uniquePatterns = [...new Set(patterns)].slice(0, 5);

    return { topActions, topEntities, frequency, patterns: uniquePatterns };
  }

  // ─── 2. Session Summary Monthly Rollup ───

  /**
   * Compress session_summary entries within 30 days into 1 monthly rollup
   * @returns {object} { compressed, created, deleted }
   */
  async _distillSessionSummaries() {
    const now = new Date();
    const windowMs = this.monthlyWindowDays * 86400 * 1000;
    const cutoff = new Date(now.getTime() - windowMs);

    const typeEntries = this.engine.index.getEntriesByType('session_summary');
    const candidates = [];
    for (const [fullKey, entry] of typeEntries) {
      const created = new Date(entry.createdAt);
      // Only compress non-distilled session_summary (avoid recursive compression)
      if (created >= cutoff && created < now) {
        const val = typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value);
        if (!val.includes('distillation:monthly_rollup')) {
          candidates.push({ fullKey, entry });
        }
      }
    }

    if (candidates.length < 2) {
      return { compressed: 0, created: 0, deleted: 0, reason: 'too_few_entries' };
    }

    // Merge all session_summary entries
    const analysis = this._mergeSessionSummaries(candidates);

    const summaryValue = JSON.stringify({
      source: 'distillation:monthly_rollup',
      period: {
        from: cutoff.toISOString(),
        to: now.toISOString(),
      },
      sessionCount: candidates.length,
      allTopics: analysis.topTopics,
      keyDecisions: analysis.keyDecisions,
      pendingItems: analysis.pendingItems,
      entitiesTouched: analysis.topEntities,
    });

    const monthLabel = cutoff.toISOString().slice(0, 7); // YYYY-MM
    const writeResult = await this.engine.remember({
      key: `distilled:monthly:${monthLabel}`,
      value: summaryValue,
      type: 'session_summary',
      ttl_seconds: 90 * 86400,  // Monthly rollup retained for 90 days
      confidence: 1.0,
    });

    let deletedCount = 0;
    if (writeResult.success) {
      for (const { fullKey } of candidates) {
        const entry = this.engine.index.delete(fullKey);
        if (entry) deletedCount++;
      }
      await this.engine._persistType('session_summary');
    }

    this._stats.sessionSummaryCompressed += deletedCount;

    return {
      compressed: candidates.length,
      created: writeResult.success ? 1 : 0,
      deleted: deletedCount,
    };
  }

  /**
   * Merge multiple session_summary entries
   */
  _mergeSessionSummaries(candidates) {
    const topicCounts = new Map();
    const decisions = [];
    const pendingItems = [];
    const entityCounts = new Map();

    for (const { entry } of candidates) {
      try {
        const val = typeof entry.value === 'string' ? JSON.parse(entry.value) : entry.value;
        if (!val || typeof val !== 'object') continue;

        // Merge topics
        if (Array.isArray(val.topics)) {
          for (const t of val.topics) {
            topicCounts.set(t, (topicCounts.get(t) || 0) + 1);
          }
        }

        // Merge decisions (keep all, deduplicate)
        if (Array.isArray(val.decisions)) {
          for (const d of val.decisions) {
            if (!decisions.includes(d)) decisions.push(d);
          }
        }

        // Merge pending (keep only uncompleted)
        if (Array.isArray(val.pending)) {
          for (const p of val.pending) {
            if (!pendingItems.includes(p)) pendingItems.push(p);
          }
        }

        // Merge entities_touched
        if (Array.isArray(val.entities_touched)) {
          for (const e of val.entities_touched) {
            entityCounts.set(e, (entityCounts.get(e) || 0) + 1);
          }
        }
      } catch {
        // Parse failed, skip
      }
    }

    const topTopics = [...topicCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([topic, count]) => ({ topic, count }));

    const topEntities = [...entityCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([entity, count]) => ({ entity, count }));

    return {
      topTopics,
      keyDecisions: decisions.slice(0, 20),
      pendingItems: pendingItems.slice(0, 10),
      topEntities,
    };
  }

  // ─── 3. User Correction Capacity Management ───

  /**
   * user_correction capacity management:
   * When user_correction entries approach the capacity limit, demote the oldest
   * entries to action_log. This keeps the latest correction records and frees
   * space for new corrections.
   *
   * Note: user_correction is designed for same-key overwrite (keeps latest),
   * so there will never be "multiple entries for the same key".
   * Distillation focuses on overall capacity control.
   * @returns {object} { demoted }
   */
  async _distillUserCorrections() {
    const typeEntries = this.engine.index.getEntriesByType('user_correction');
    const maxEntries = 100; // user_correction capacity limit
    const threshold = Math.floor(maxEntries * 0.7); // Trigger cleanup at 70%

    if (typeEntries.size < threshold) {
      return { upgraded: 0, demoted: 0, reason: 'below_threshold' };
    }

    // Sort by creation time, oldest first
    const sorted = [...typeEntries.entries()]
      .sort((a, b) => new Date(a[1].createdAt) - new Date(b[1].createdAt));

    // Demote oldest entries (keep latest 50%)
    const toDemote = Math.floor(sorted.length * 0.5);
    let demoted = 0;

    for (let i = 0; i < toDemote; i++) {
      const [fullKey, entry] = sorted[i];

      // Skip protected entries
      if (entry.protected) continue;

      // Demote to action_log
      await this.engine.remember({
        key: `correction_archived:${entry._originalKey || fullKey}`,
        value: typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value),
        type: 'action_log',
        ttl_seconds: 7 * 86400,
        confidence: 0.5,
      });

      // Delete from user_correction
      this.engine.index.delete(fullKey);
      demoted++;
    }

    if (demoted > 0) {
      await this.engine._persistType('user_correction');
      await this.engine._persistType('action_log');
    }

    return { upgraded: 0, demoted };
  }
}

export default DistillationEngine;
