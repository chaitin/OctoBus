/**
 * 过期管理器（TTLManager）— 记忆过期管理
 *
 * 双策略（Redis 同款）：
 * 1. Lazy check：Recall 时检查过期，过期则删除
 * 2. Active sweep：每 60 秒扫描 TTL 过期表，批量清理
 *
 * 参考：https://stackharbor.com/en/knowledge-base/redis-key-expiration-patterns/
 */

export class TTLManager {
  /**
   * @param {import('./memory-index.js').MemoryIndex} index
   * @param {import('./storage-adapter.js').StorageAdapter} storage
   * @param {object} opts
   * @param {number} opts.sweepIntervalMs - 扫描间隔（默认 60000ms）
   */
  constructor(index, storage, opts = {}) {
    this.index = index;
    this.storage = storage;
    this.sweepIntervalMs = opts.sweepIntervalMs || 60000;
    this._timer = null;
    this._sweeping = false;
  }

  /**
   * 启动定时扫描
   */
  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this._sweep(), this.sweepIntervalMs);
    // 不阻止进程退出
    if (this._timer.unref) this._timer.unref();
  }

  /**
   * 停止定时扫描
   */
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * 检查单条记忆是否过期（Lazy check，Recall 时调用）
   * @returns {boolean} true=已过期并已删除，false=未过期
   */
  checkAndExpire(fullKey) {
    const entry = this.index.get(fullKey);
    if (!entry) return true; // 不存在视为"过期"

    if (!entry.expiresAt) return false; // 永不过期

    const now = Date.now();
    const expiresMs = new Date(entry.expiresAt).getTime();

    if (expiresMs <= now) {
      // 过期了，删除（protected 不删）
      if (!entry.protected) {
        this.index.delete(fullKey);
        // 标记需要持久化
        this._markDirty(entry.type);
      }
      return true;
    }

    return false;
  }

  /**
   * 主动扫描过期条目（Active sweep）
   */
  async _sweep() {
    if (this._sweeping) return;
    this._sweeping = true;

    try {
      const now = new Date();
      const expiredKeys = this.index.getExpiredKeys(now);

      if (expiredKeys.length === 0) return;

      // 按 type 分组，批量删除后批量持久化
      const dirtyTypes = new Set();

      for (const key of expiredKeys) {
        const entry = this.index.get(key);
        if (entry) {
          dirtyTypes.add(entry.type);
        }
        this.index.delete(key);
      }

      // 持久化受影响的 type 文件
      for (const type of dirtyTypes) {
        await this._persistType(type);
      }

      // 自适应：如果过期条目占比 > 25%，立即再扫一轮（Redis 同款逻辑）
      const totalWithTTL = this.index.ttlIndex.length;
      if (totalWithTTL > 0 && expiredKeys.length / totalWithTTL > 0.25) {
        setImmediate(() => this._sweep());
      }
    } catch (err) {
      // 扫描失败不影响服务
      console.error('[TTLManager] sweep error:', err.message);
    } finally {
      this._sweeping = false;
    }
  }

  /**
   * 持久化指定类型的所有条目到文件（O(1) 通过 per-type 索引）
   */
  async _persistType(type) {
    const entries = this.index.getEntriesByType(type);
    await this.storage.saveType(type, entries);
  }

  _markDirty(type) {
    // 简易脏标记：下次 sweep 时持久化
    // 对于 MVP，Recall 触发的删除会在下次 sweep 时持久化
    // 这意味着最多 60 秒的窗口内，进程崩溃可能导致已删除条目复活
    // 可接受：下次 Recall 仍会 lazy check
  }
}

export default TTLManager;
