/**
 * 文档记忆管理
 * 移植自 Python 版本 src/brief/document_ops.py 的记忆机制
 *
 * 记忆文件：doc_memory.json
 * 结构：{ [nodeId]: { header_length, last_brief_title, last_updated } }
 *
 * 作用：
 * - 避免每次全量扫描文档来定位 header 结束位置
 * - 记住上次简报标题，用于提取"上次交流上下文"
 *
 * 2026-07 重构：dataDir 改为统一使用 state-manager 的数据目录，
 * 通过 STATE_DATA_DIR 环境变量注入，消除独立 dataDir 配置。
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';

export class DocMemory {
  constructor(stateDataDir) {
    this.dataDir = stateDataDir;
    this.filePath = join(stateDataDir, 'doc_memory.json');
    this.cache = null;
  }

  /**
   * 加载记忆（懒加载 + 缓存）
   */
  async load() {
    if (this.cache) return this.cache;

    try {
      const raw = await readFile(this.filePath, 'utf-8');
      this.cache = JSON.parse(raw);
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  /**
   * 保存记忆到文件（原子写入：先写临时文件再 rename，防止并发损坏）
   */
  async save() {
    if (!this.cache) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    const { rename } = await import('node:fs/promises');
    const tmpPath = `${this.filePath}.${Date.now()}.tmp`;
    await writeFile(tmpPath, JSON.stringify(this.cache, null, 2), 'utf-8');
    await rename(tmpPath, this.filePath);
  }

  /**
   * 获取指定文档的记忆
   */
  async get(nodeId) {
    const memory = await this.load();
    return memory[nodeId] || null;
  }

  /**
   * 更新文档记忆
   */
  async set(nodeId, { headerLength, lastBriefTitle }) {
    const memory = await this.load();
    memory[nodeId] = {
      header_length: headerLength,
      last_brief_title: lastBriefTitle,
      last_updated: new Date().toISOString(),
    };
    await this.save();
  }

  /**
   * 找到文档 header 结束位置（第一个 # 标题的行号）
   * 移植自 Python _find_header_end()
   */
  static findHeaderEnd(content) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      // 跳过空行和文档头部（通常以 # 开头的项目标题行之前）
      if (lines[i].startsWith('# ') && i > 0) {
        return i;
      }
    }
    // 如果没有找到，返回第一个非空行之后
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() !== '') return i + 1;
    }
    return 0;
  }
}
