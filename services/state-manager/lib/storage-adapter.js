/**
 * 存储适配器（StorageAdapter）— JSON file per type 持久化存储
 *
 * 每种记忆类型一个 JSON 文件，原子写入（write tmp → rename）。
 * 文件格式版本化，便于未来迁移。
 */

import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const FILE_VERSION = 1;
const MEMORY_TYPES = ['entity_cache', 'action_log', 'user_correction', 'commitment', 'session_summary'];

export class StorageAdapter {
  constructor(dataDir) {
    this.dataDir = dataDir;
    // Promise 队列锁：每个 type 一条串行链，避免并发写同一文件
    this._writeChains = new Map();
  }

  /**
   * 获取指定类型的文件路径
   */
  _filePath(type) {
    return join(this.dataDir, `memory_${type}.json`);
  }

  /**
   * 读取指定类型的所有条目
   * @returns {Map<string, object>} key → entry
   */
  async loadType(type) {
    const filePath = this._filePath(type);
    try {
      const raw = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed.version !== FILE_VERSION) {
        // 未来版本迁移点
      }
      return new Map(Object.entries(parsed.entries || {}));
    } catch {
      return new Map();
    }
  }

  /**
   * 写入指定类型的所有条目（原子写）
   * 使用 Promise 链保证同一 type 的写操作串行执行
   * @param {string} type
   * @param {Map<string, object>} entries
   */
  async saveType(type, entries) {
    // Promise 链：新写入排在上一次写入之后，天然串行
    const prev = this._writeChains.get(type) || Promise.resolve();
    const next = prev.then(async () => {
      const filePath = this._filePath(type);
      await mkdir(dirname(filePath), { recursive: true });

      const data = {
        version: FILE_VERSION,
        updatedAt: new Date().toISOString(),
        entryCount: entries.size,
        entries: Object.fromEntries(entries),
      };

      // 原子写：先写临时文件，再 rename
      const tmpPath = filePath + '.tmp';
      await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
      await rename(tmpPath, filePath);
    }).catch(err => {
      console.error(`[StorageAdapter] saveType(${type}) error:`, err.message);
    });
    this._writeChains.set(type, next);
    return next;
  }

  /**
   * 加载所有记忆类型的条目
   * @returns {Map<string, Map<string, object>>} type → (key → entry)
   */
  async loadAll() {
    const result = new Map();
    for (const type of MEMORY_TYPES) {
      result.set(type, await this.loadType(type));
    }
    return result;
  }

  /**
   * 等待所有进行中的写操作完成（优雅停机用）
   */
  async waitForPendingWrites() {
    const pending = [...this._writeChains.values()];
    await Promise.allSettled(pending);
  }

  /**
   * 删除指定类型的存储文件（用于测试或重置）
   */
  async deleteType(type) {
    const filePath = this._filePath(type);
    try {
      await unlink(filePath);
    } catch {
      // 文件不存在，忽略
    }
  }
}

export default StorageAdapter;
