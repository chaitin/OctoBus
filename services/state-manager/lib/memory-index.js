/**
 * 记忆索引（MemoryIndex）— 内存前缀索引 + TTL 过期表 + 容量计数器
 *
 * 前缀索引：按 key 的 `:` 分割段构建嵌套 Map，支持 O(k) 前缀查询
 * TTL 过期表：按过期时间排序的数组，Active Sweep 只扫描即将过期的条目
 * 容量计数器：per-type 计数，超限触发 LRU 淘汰
 */

export class MemoryIndex {
  constructor() {
    // 前缀索引：嵌套 Map
    // "acme:user1:entity_cache:crm_user:self" →
    //   trie.acme.user1.entity_cache.crm_user.self = entry
    this.trie = new Map();

    // 全量 key → entry 的扁平 Map（用于精确查找）
    this.entries = new Map();

    // per-type entries Map（避免 _persistType 全量遍历）
    // type → Map<fullKey, entry>
    this.entriesByType = new Map();

    // TTL 过期表：{ expiresAt, key } 按时间排序
    this.ttlIndex = [];

    // per-type 容量计数
    this.typeCounts = new Map();

    // 是否需要重排 TTL 过期表
    this._ttlSorted = true;
  }

  /**
   * 插入或更新一条记忆
   */
  set(fullKey, entry) {
    const old = this.entries.get(fullKey);

    // 更新扁平 Map
    this.entries.set(fullKey, entry);

    // 更新 per-type Map
    const type = entry.type;
    if (!this.entriesByType.has(type)) {
      this.entriesByType.set(type, new Map());
    }
    this.entriesByType.get(type).set(fullKey, entry);

    // 更新前缀索引
    this._insertTrie(fullKey, entry);

    // 更新 TTL 过期表
    if (old && old.expiresAt) {
      // 移除旧的 TTL 记录
      this.ttlIndex = this.ttlIndex.filter(t => t.key !== fullKey);
    }
    if (entry.expiresAt) {
      this.ttlIndex.push({ expiresAt: entry.expiresAt, key: fullKey });
      this._ttlSorted = false;
    }

    // 更新容量计数
    if (!old) {
      this.typeCounts.set(type, (this.typeCounts.get(type) || 0) + 1);
    }
  }

  /**
   * 精确查找
   */
  get(fullKey) {
    return this.entries.get(fullKey) || null;
  }

  /**
   * 前缀查找
   * @param {string} prefix - 如 "acme:user1:entity_cache:"
   * @param {object} opts - { type, limit }
   * @returns {object[]} 匹配的 entry 列表，按 createdAt 倒序
   */
  getByPrefix(prefix, opts = {}) {
    const segments = prefix.split(':').filter(Boolean);
    let node = this.trie;

    // 沿前缀段逐层深入
    for (const seg of segments) {
      if (!node.has(seg)) return [];
      node = node.get(seg);
    }

    // 收集该节点下所有叶子
    const results = [];
    this._collectLeaves(node, results);

    // 按 type 过滤
    let filtered = opts.type
      ? results.filter(e => e.type === opts.type)
      : results;

    // 按 confidence 过滤（< 0.3 的不返回）
    filtered = filtered.filter(e => e.confidence >= 0.3);

    // TTL lazy check：过期的不返回
    const now = Date.now();
    filtered = filtered.filter(e => {
      if (!e.expiresAt) return true;
      return new Date(e.expiresAt).getTime() > now;
    });

    // 按 createdAt 倒序
    filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // 限制条数
    if (opts.limit && opts.limit > 0) {
      filtered = filtered.slice(0, opts.limit);
    }

    return filtered;
  }

  /**
   * 删除一条记忆
   */
  delete(fullKey) {
    const entry = this.entries.get(fullKey);
    if (!entry) return null;

    // 移除扁平 Map
    this.entries.delete(fullKey);

    // 移除 per-type Map
    const typeMap = this.entriesByType.get(entry.type);
    if (typeMap) typeMap.delete(fullKey);

    // 移除前缀索引
    this._deleteTrie(fullKey);

    // 移除 TTL 记录
    this.ttlIndex = this.ttlIndex.filter(t => t.key !== fullKey);

    // 更新容量计数
    this.typeCounts.set(entry.type, Math.max(0, (this.typeCounts.get(entry.type) || 1) - 1));

    return entry;
  }

  /**
   * 批量删除（按前缀 + type）
   * @returns {number} 删除条数
   */
  deleteByPrefix(prefix, type = null) {
    const matches = this.getByPrefix(prefix, { type, limit: 100000 });
    let count = 0;
    for (const entry of matches) {
      this.delete(entry._fullKey || this._findFullKey(entry));
      count++;
    }
    return count;
  }

  /**
   * 获取指定类型的条目数
   */
  getTypeCount(type) {
    return this.typeCounts.get(type) || 0;
  }

  /**
   * 获取已过期的条目 key 列表
   * @param {Date} now - 当前时间
   * @returns {string[]} 已过期但未被清理的 key
   */
  getExpiredKeys(now = new Date()) {
    this._ensureTtlSorted();

    const nowMs = now.getTime();
    const expired = [];

    // TTL 过期表按时间排序，二分查找过期分界点
    for (const item of this.ttlIndex) {
      if (new Date(item.expiresAt).getTime() <= nowMs) {
        const entry = this.entries.get(item.key);
        // 跳过 protected 条目
        if (entry && !entry.protected) {
          expired.push(item.key);
        }
      } else {
        break; // 排序了，后面的都不会过期
      }
    }

    return expired;
  }

  /**
   * 获取指定类型中最旧/最久未访问的条目（LRU/oldest 淘汰用）
   * @param {string} type
   * @param {string} policy - 'lru' | 'oldest' | 'compress'
   * @param {number} count - 要淘汰的条目数
   * @returns {string[]} 要淘汰的 key 列表
   */
  getCandidatesForEviction(type, policy, count) {
    const entries = [];
    for (const [key, entry] of this.entries) {
      if (entry.type === type && !entry.protected) {
        entries.push({ key, entry });
      }
    }

    if (policy === 'oldest') {
      entries.sort((a, b) => new Date(a.entry.createdAt) - new Date(b.entry.createdAt));
    } else if (policy === 'lru') {
      entries.sort((a, b) => new Date(a.entry.lastAccessAt || a.entry.createdAt) - new Date(b.entry.lastAccessAt || b.entry.createdAt));
    } else if (policy === 'compress') {
      // compress：同 key 前缀的只保留最新的
      // 返回非最新的同 key 条目
      const seen = new Map();
      const toEvict = [];
      entries.sort((a, b) => new Date(b.entry.createdAt) - new Date(a.entry.createdAt));
      for (const e of entries) {
        const shortKey = e.entry._originalKey || e.key;
        if (seen.has(shortKey)) {
          toEvict.push(e.key);
        } else {
          seen.set(shortKey, e.key);
        }
      }
      return toEvict.slice(0, count);
    }

    return entries.slice(0, count).map(e => e.key);
  }

  /**
   * 获取指定类型的所有条目 Map（O(1)，避免全量遍历）
   * @param {string} type
   * @returns {Map<string, object>}
   */
  getEntriesByType(type) {
    return this.entriesByType.get(type) || new Map();
  }

  /**
   * 获取引擎统计信息
   */
  getStats() {
    const typeStats = {};
    for (const [type, count] of this.typeCounts) {
      typeStats[type] = {
        count,
        protected: [...(this.entriesByType.get(type) || [])].filter(([, e]) => e.protected).length,
      };
    }
    return {
      totalEntries: this.entries.size,
      ttlIndexSize: this.ttlIndex.length,
      types: typeStats,
    };
  }

  /**
   * 批量重建索引（从 StorageAdapter 加载后调用）
   */
  rebuild(allEntries) {
    this.trie.clear();
    this.entries.clear();
    this.entriesByType.clear();
    this.ttlIndex = [];
    this.typeCounts.clear();
    this._ttlSorted = true;

    for (const [type, typeEntries] of allEntries) {
      for (const [fullKey, entry] of typeEntries) {
        this.set(fullKey, entry);
      }
    }
  }

  // ─── 内部方法 ───

  _insertTrie(fullKey, entry) {
    const segments = fullKey.split(':');
    let node = this.trie;
    for (const seg of segments) {
      if (!node.has(seg)) {
        node.set(seg, new Map());
      }
      node = node.get(seg);
    }
    // 最深层的 Map 存 entry（用特殊 key）
    node.set('__entry__', entry);
  }

  _deleteTrie(fullKey) {
    const segments = fullKey.split(':');
    let node = this.trie;
    const path = [this.trie];

    for (const seg of segments) {
      if (!node.has(seg)) return;
      node = node.get(seg);
      path.push(node);
    }

    // 删除叶子 entry
    node.delete('__entry__');

    // 回溯清理空分支（可选优化，MVP 不做）
  }

  _collectLeaves(node, results) {
    if (node.has('__entry__')) {
      const entry = node.get('__entry__');
      results.push({ ...entry, _fullKey: this._reconstructKey(entry) });
    }
    for (const [key, child] of node) {
      if (key !== '__entry__' && child instanceof Map) {
        this._collectLeaves(child, results);
      }
    }
  }

  _reconstructKey(entry) {
    // 从 entry 的 metadata 重建 fullKey
    // 这是一个简化实现：遍历 entries Map 反查
    for (const [k, v] of this.entries) {
      if (v === entry) return k;
    }
    return '';
  }

  _findFullKey(entry) {
    for (const [k, v] of this.entries) {
      if (v.createdAt === entry.createdAt && v.type === entry.type) return k;
    }
    return '';
  }

  _ensureTtlSorted() {
    if (!this._ttlSorted) {
      this.ttlIndex.sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt));
      this._ttlSorted = true;
    }
  }
}

export default MemoryIndex;
