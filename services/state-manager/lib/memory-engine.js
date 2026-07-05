/**
 * 记忆引擎（MemoryEngine）— Remember/Recall/Forget 核心逻辑
 *
 * 职责：
 * - 前缀拼接（tenant:user:type:key）
 * - 去重检查（dedup_window 内同 key 同值跳过）
 * - 容量管理（超限触发 LRU/oldest 淘汰）
 * - 置信度保护（high confidence + 永不过期 → 不被淘汰）
 */

import { resolve as resolveType, listTypes } from './type-registry.js';

/**
 * 操作日志（审计/调试用），保留最近 MAX_LOG_SIZE 条
 */
const MAX_LOG_SIZE = 500;

export class MemoryEngine {
  /**
   * @param {import('./memory-index.js').MemoryIndex} index
   * @param {import('./storage-adapter.js').StorageAdapter} storage
   * @param {import('./ttl-manager.js').TTLManager} ttlManager
   * @param {object} config - { tenant, userId }
   */
  constructor(index, storage, ttlManager, config = {}) {
    this.index = index;
    this.storage = storage;
    this.ttlManager = ttlManager;
    this.tenant = config.tenant || 'default';
    this.userId = config.userId || 'shared';

    // 操作日志（ring buffer）
    this._opLog = [];
    // 累计统计
    this._stats = {
      rememberCalls: 0,
      recallCalls: 0,
      forgetCalls: 0,
      rememberErrors: 0,
      recallErrors: 0,
      forgetErrors: 0,
      totalEvictions: 0,
      totalDedups: 0,
    };
  }

  /**
   * 记录操作日志
   */
  _log(op, detail) {
    this._opLog.push({ op, detail, ts: new Date().toISOString() });
    if (this._opLog.length > MAX_LOG_SIZE) {
      this._opLog.splice(0, this._opLog.length - MAX_LOG_SIZE);
    }
  }

  /**
   * 获取引擎运行统计
   */
  getStats() {
    const indexStats = this.index.getStats();
    return {
      ...this._stats,
      ...indexStats,
      tenant: this.tenant,
      userId: this.userId,
      recentOps: this._opLog.slice(-20),
    };
  }

  /**
   * 拼接完整 key：{tenant}:{user}:{type}:{key}
   */
  _fullKey(type, key) {
    return `${this.tenant}:${this.userId}:${type}:${key}`;
  }

  /**
   * 从 user-config 加载 tenant 和 userId
   */
  async loadIdentity(userConfigPath) {
    try {
      const { readFile } = await import('node:fs/promises');
      const raw = await readFile(userConfigPath, 'utf-8');
      const config = JSON.parse(raw);
      this.tenant = config.company_english || config.companyName || 'default';
      this.userId = config.identity?.user_id || 'shared';
    } catch {
      // 配置文件不存在时用默认值
    }
  }

  // ─── Remember ───

  /**
   * 写入一条记忆
   * @param {object} request - { key, value, type, ttl_seconds, dedup_window_sec, confidence }
   * @returns {object} { success, unchanged, evicted_count, error }
   */
  async remember(request) {
    try {
      this._stats.rememberCalls++;
      const resolved = resolveType(request);
      const fullKey = this._fullKey(resolved.type, resolved.key);
      const now = new Date();

      // 去重检查
      const existing = this.index.get(fullKey);
      if (existing && resolved.dedupWindowSec > 0) {
        const createdMs = new Date(existing.createdAt).getTime();
        const windowMs = resolved.dedupWindowSec * 1000;
        if (now.getTime() - createdMs < windowMs) {
          // 去重窗口内：同 key 同值 → 跳过
          if (existing.value === resolved.value) {
            this._stats.totalDedups++;
            this._log('remember', { key: resolved.key, type: resolved.type, result: 'dedup' });
            return { success: true, unchanged: true, evictedCount: 0, error: '' };
          }
          // 同 key 异值 → 更新（不跳过）
        }
      }

      // 计算过期时间
      const expiresAt = resolved.ttlSeconds > 0
        ? new Date(now.getTime() + resolved.ttlSeconds * 1000).toISOString()
        : null;

      // 构建记忆条目
      const entry = {
        key: fullKey,
        _originalKey: resolved.key,
        value: resolved.value,
        type: resolved.type,
        confidence: resolved.confidence,
        createdAt: existing ? existing.createdAt : now.toISOString(),
        updatedAt: now.toISOString(),
        expiresAt,
        lastAccessAt: now.toISOString(),
        accessCount: (existing?.accessCount || 0) + 1,
        protected: resolved.protected,
      };

      // 容量检查 + 淘汰
      let evictedCount = 0;
      const currentCount = this.index.getTypeCount(resolved.type);
      const maxEntries = resolved.maxEntries;
      if (!existing && currentCount >= maxEntries) {
        evictedCount = await this._evict(resolved.type, resolved.evictPolicy, currentCount - maxEntries + 1);
        this._stats.totalEvictions += evictedCount;
      }

      // 写入索引
      this.index.set(fullKey, entry);

      // 持久化
      await this._persistType(resolved.type);

      this._log('remember', { key: resolved.key, type: resolved.type, result: existing ? 'updated' : 'created', evicted: evictedCount });
      return { success: true, unchanged: false, evictedCount, error: '' };
    } catch (err) {
      this._stats.rememberErrors++;
      this._log('remember', { key: request.key, type: request.type, result: 'error', error: err.message });
      return { success: false, unchanged: false, evictedCount: 0, error: err.message };
    }
  }

  // ─── Recall ───

  /**
   * 读取记忆
   * @param {object} request - { key, prefix, type, limit }
   * @returns {object} { success, entries, error }
   */
  async recall(request) {
    try {
      this._stats.recallCalls++;
      const limit = request.limit || 10;
      let results = [];

      if (request.key) {
        // 精确匹配
        const type = request.type || 'entity_cache';
        const fullKey = this._fullKey(type, request.key);

        let entry = this.index.get(fullKey);

        // 如果精确 key 找不到，遍历所有已注册类型查找
        if (!entry) {
          for (const t of listTypes()) {
            const tryKey = this._fullKey(t.type, request.key);
            entry = this.index.get(tryKey);
            if (entry) break;
          }
        }

        if (entry) {
          // TTL lazy check
          if (this.ttlManager.checkAndExpire(entry.key)) {
            await this._persistType(entry.type);
            results = [];
          } else {
            // 更新访问信息
            entry.lastAccessAt = new Date().toISOString();
            entry.accessCount = (entry.accessCount || 0) + 1;
            this.index.set(entry.key, entry);

            results = [{
              key: entry._originalKey || request.key,
              value: entry.value,
              type: entry.type,
              confidence: entry.confidence,
              createdAt: entry.createdAt,
              expiresAt: entry.expiresAt || '',
            }];
          }
        }
      } else if (request.prefix) {
        // 前缀匹配
        const type = request.type || '';
        const prefix = type
          ? this._fullKey(type, request.prefix)
          : `${this.tenant}:${this.userId}:${request.prefix}`;

        const matches = this.index.getByPrefix(prefix.endsWith(':') ? prefix : prefix + ':', {
          type: request.type || null,
          limit,
        });

        // 也尝试不含尾冒号的前缀
        if (matches.length === 0) {
          const altMatches = this.index.getByPrefix(prefix, {
            type: request.type || null,
            limit,
          });
          results = altMatches.map(e => ({
            key: e._originalKey || e.key,
            value: e.value,
            type: e.type,
            confidence: e.confidence,
            createdAt: e.createdAt,
            expiresAt: e.expiresAt || '',
          }));
        } else {
          results = matches.map(e => ({
            key: e._originalKey || e.key,
            value: e.value,
            type: e.type,
            confidence: e.confidence,
            createdAt: e.createdAt,
            expiresAt: e.expiresAt || '',
          }));
        }

        // 更新访问信息
        for (const r of results) {
          for (const [k, v] of this.index.entries) {
            if (v._originalKey === r.key && v.type === r.type) {
              v.lastAccessAt = new Date().toISOString();
              v.accessCount = (v.accessCount || 0) + 1;
              break;
            }
          }
        }
      }

      this._log('recall', { key: request.key || request.prefix, type: request.type, results: results.length });
      return { success: true, entries: results, error: '' };
    } catch (err) {
      this._stats.recallErrors++;
      this._log('recall', { key: request.key || request.prefix, result: 'error', error: err.message });
      return { success: false, entries: [], error: err.message };
    }
  }

  // ─── Forget ───

  /**
   * 删除记忆
   * @param {object} request - { key, prefix, type }
   * @returns {object} { success, deleted_count, error }
   */
  async forget(request) {
    try {
      this._stats.forgetCalls++;
      let deletedCount = 0;
      const dirtyTypes = new Set();

      if (request.key) {
        // 精确删除
        const type = request.type || 'entity_cache';
        const fullKey = this._fullKey(type, request.key);
        const entry = this.index.delete(fullKey);
        if (entry) {
          deletedCount = 1;
          dirtyTypes.add(entry.type);
        }
      } else if (request.prefix) {
        // 前缀批量删除
        const type = request.type || '';
        const prefix = type
          ? this._fullKey(type, request.prefix)
          : `${this.tenant}:${this.userId}:${request.prefix}`;

        const matches = this.index.getByPrefix(prefix.endsWith(':') ? prefix : prefix + ':', {
          type: request.type || null,
          limit: 100000,
        });

        for (const match of matches) {
          const fullKey = match._fullKey || match.key;
          const entry = this.index.delete(fullKey);
          if (entry) {
            deletedCount++;
            dirtyTypes.add(entry.type);
          }
        }
      }

      // 持久化受影响的 type
      for (const type of dirtyTypes) {
        await this._persistType(type);
      }

      this._log('forget', { key: request.key || request.prefix, type: request.type, deleted: deletedCount });
      return { success: true, deletedCount, error: '' };
    } catch (err) {
      this._stats.forgetErrors++;
      this._log('forget', { key: request.key || request.prefix, result: 'error', error: err.message });
      return { success: false, deletedCount: 0, error: err.message };
    }
  }

  // ─── 内部方法 ───

  /**
   * 淘汰指定类型的条目
   * @param {string} type
   * @param {string} policy - 'lru' | 'oldest' | 'compress'
   * @param {number} count - 要淘汰的条目数
   * @returns {number} 实际淘汰的条目数
   */
  async _evict(type, policy, count) {
    const candidates = this.index.getCandidatesForEviction(type, policy, count);
    let evicted = 0;

    for (const key of candidates) {
      const entry = this.index.delete(key);
      if (entry) evicted++;
    }

    if (evicted > 0) {
      await this._persistType(type);
    }

    return evicted;
  }

  /**
   * 持久化指定类型到文件（O(1) 通过 per-type 索引）
   */
  async _persistType(type) {
    const entries = this.index.getEntriesByType(type);
    await this.storage.saveType(type, entries);
  }
}

export default MemoryEngine;
