/**
 * 事件日志（EventLog）— Append-only 事件日志
 *
 * 记录智能体平台中"发生了什么"，用于审计/调试/回溯。
 * 与 Loader 的 Event Bus 互补：
 *   - Loader Event Bus：实时触发（pub/sub），"什么时候跑"
 *   - EventLog：历史记录（append-only），"发生了什么"
 *
 * 设计原则：
 *   - Append-only，不删除不修改
 *   - 按时间排序，支持范围查询
 *   - 文件按大小轮转（maxEvents 条后新建文件）
 *   - 不引入 pub/sub，与 Loader 零耦合
 */

import { readFile, writeFile, mkdir, readdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const DEFAULT_MAX_EVENTS = 5000;    // 单文件最大事件数
const DEFAULT_MAX_FILES = 5;        // 最多保留的轮转文件数

export class EventLog {
  /**
   * @param {string} dataDir
   * @param {object} opts
   * @param {number} opts.maxEvents - 单文件最大事件数
   * @param {number} opts.maxFiles - 轮转文件数上限
   */
  constructor(dataDir, opts = {}) {
    this.dataDir = dataDir;
    this.filePath = join(dataDir, 'event_log.json');
    this.maxEvents = opts.maxEvents || DEFAULT_MAX_EVENTS;
    this.maxFiles = opts.maxFiles || DEFAULT_MAX_FILES;

    // 内存中的事件缓冲（最近的事件）
    this.events = [];
    this._dirty = false;
    this._saveChain = Promise.resolve();  // 串行化并发 _save 调用

    // 统计
    this._stats = {
      totalLogged: 0,
      totalRotated: 0,
    };
  }

  // ─── 生命周期 ───

  async initialize() {
    await this._load();
    console.log(`[EventLog] initialized: ${this.events.length} events loaded`);
  }

  async shutdown() {
    if (this._dirty) await this._save();
  }

  // ─── 写入事件 ───

  /**
   * 记录一个事件
   * @param {object} request
   * @param {string} request.event_type - 事件类型（如 agent.remember, loader.triggered, task.state_changed）
   * @param {string} request.actor - 触发者（智能体名称/系统/用户）
   * @param {string} request.description - 事件描述
   * @param {object} request.data - 附加数据
   * @param {string} request.level - info / warning / error
   * @returns {object} { success, event_id, error }
   */
  async logEvent(request) {
    try {
      const eventId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const event = {
        event_id: eventId,
        event_type: request.event_type || 'unknown',
        actor: request.actor || 'system',
        description: request.description || '',
        data: request.data || {},
        level: request.level || 'info',
        timestamp: new Date().toISOString(),
      };

      this.events.push(event);
      this._stats.totalLogged++;
      this._dirty = true;

      // 检查是否需要轮转
      if (this.events.length >= this.maxEvents) {
        await this._rotate();
      }

      // 立即持久化（事件日志要求可靠写入，串行化防并发损坏）
      this._dirty = true;
      await this._save();

      return { success: true, event_id: eventId, error: '' };
    } catch (err) {
      return { success: false, event_id: '', error: err.message };
    }
  }

  // ─── 查询事件 ───

  /**
   * 查询事件
   * @param {object} filter
   * @param {string} filter.event_type - 按事件类型过滤
   * @param {string} filter.actor - 按触发者过滤
   * @param {string} filter.level - 按级别过滤
   * @param {string} filter.since - 起始时间（ISO 8601）
   * @param {string} filter.until - 结束时间（ISO 8601）
   * @param {string} filter.search - 关键词搜索（在 description 中匹配）
   * @param {number} filter.limit - 最大返回条数（默认 50）
   * @returns {object} { success, events, total, error }
   */
  async queryEvents(filter = {}) {
    let results = [...this.events];

    // 按事件类型过滤
    if (filter.event_type) {
      const types = filter.event_type.split(',');
      results = results.filter(e => types.includes(e.event_type));
    }

    // 按触发者过滤
    if (filter.actor) {
      results = results.filter(e => e.actor === filter.actor);
    }

    // 按级别过滤
    if (filter.level) {
      results = results.filter(e => e.level === filter.level);
    }

    // 按时间范围过滤
    if (filter.since) {
      const since = new Date(filter.since);
      results = results.filter(e => new Date(e.timestamp) >= since);
    }
    if (filter.until) {
      const until = new Date(filter.until);
      results = results.filter(e => new Date(e.timestamp) <= until);
    }

    // 关键词搜索
    if (filter.search) {
      const keyword = filter.search.toLowerCase();
      results = results.filter(e =>
        (e.description || '').toLowerCase().includes(keyword) ||
        (e.event_type || '').toLowerCase().includes(keyword)
      );
    }

    // 按时间倒序（最新的在前）
    results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const total = results.length;
    const limit = filter.limit || 50;
    results = results.slice(0, limit);

    return { success: true, events: results, total, error: '' };
  }

  /**
   * 获取事件日志统计
   */
  getStats() {
    const typeCounts = {};
    const actorCounts = {};
    const levelCounts = { info: 0, warning: 0, error: 0 };

    for (const event of this.events) {
      typeCounts[event.event_type] = (typeCounts[event.event_type] || 0) + 1;
      actorCounts[event.actor] = (actorCounts[event.actor] || 0) + 1;
      if (levelCounts[event.level] !== undefined) {
        levelCounts[event.level]++;
      }
    }

    return {
      totalEvents: this.events.length,
      ...this._stats,
      typeCounts,
      actorCounts,
      levelCounts,
      oldestEvent: this.events.length > 0 ? this.events[0].timestamp : null,
      newestEvent: this.events.length > 0 ? this.events[this.events.length - 1].timestamp : null,
    };
  }

  // ─── 内部方法 ───

  /**
   * 文件轮转：当前文件重命名为 .1，旧文件递增
   */
  async _rotate() {
    try {
      // 先落盘内存中的事件，防止轮转时丢数据
      await this._save();

      // 递增轮转文件编号
      for (let i = this.maxFiles - 1; i >= 1; i--) {
        const from = join(this.dataDir, `event_log.${i}.json`);
        const to = join(this.dataDir, `event_log.${i + 1}.json`);
        try {
          await rename(from, to);
        } catch {
          // 文件不存在，跳过
        }
      }

      // 当前文件 → .1
      try {
        await rename(this.filePath, join(this.dataDir, 'event_log.1.json'));
      } catch {
        // 当前文件不存在，忽略
      }

      // 清空内存
      this.events = [];
      this._stats.totalRotated++;
      this._dirty = false;
    } catch (err) {
      console.error('[EventLog] rotation error:', err.message);
    }
  }

  async _load() {
    try {
      await mkdir(this.dataDir, { recursive: true });
      const raw = await readFile(this.filePath, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.events)) {
        this.events = data.events;
      }
    } catch {
      // 文件不存在，从空开始
    }
  }

  async _save() {
    // 串行化并发写入，防止同一 tmp 文件冲突
    this._saveChain = this._saveChain.then(async () => {
      try {
        await mkdir(this.dataDir, { recursive: true });
        const data = {
          version: 1,
          updatedAt: new Date().toISOString(),
          eventCount: this.events.length,
          events: this.events,
        };
        const tmpPath = `${this.filePath}.${Date.now()}.tmp`;
        await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
        await rename(tmpPath, this.filePath);
        this._dirty = false;
      } catch (err) {
        console.error('[EventLog] save error:', err.message);
      }
    }).catch(() => {});
    return this._saveChain;
  }
}

export default EventLog;
