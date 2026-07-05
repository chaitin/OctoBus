/**
 * 安全检查 + 备份
 * 移植自 Python 版本 src/brief/document_ops.py
 *
 * 安全策略：
 * - 新内容长度不能小于原文档的 50%（防止数据丢失）
 * - 每次更新前自动备份原文档
 *
 * 踩坑记录：
 * - 文档读取的内容含 HTML span 标签，原样写回会被 API 拒绝 "invalid control characters"
 * - 需要在写入前清理这些标签
 */

import { writeFile, mkdir, copyFile } from 'fs/promises';
import { join } from 'path';

/**
 * 安全检查：新内容不能太短
 * @param {string} originalContent - 原文档内容
 * @param {string} newContent - 新文档内容
 * @returns {{safe: boolean, reason: string}}
 */
export function safetyCheck(originalContent, newContent) {
  if (!originalContent || originalContent.length === 0) {
    return { safe: true, reason: '' };
  }

  const ratio = newContent.length / originalContent.length;
  if (ratio < 0.5) {
    return {
      safe: false,
      reason: `新内容长度 (${newContent.length}) 仅为原文档 (${originalContent.length}) 的 ${(ratio * 100).toFixed(1)}%，可能丢失数据`,
    };
  }

  return { safe: true, reason: '' };
}

/**
 * 清理 HTML span 标签
 * 钉钉文档 API 返回的内容可能含 <span> 标签，写回时会被拒绝
 */
export function cleanHtmlTags(content) {
  // 移除 <span ...> 和 </span> 标签，保留内容
  return content.replace(/<\/?span[^>]*>/g, '');
}

/**
 * 备份文档到指定目录
 */
export async function backupDocument(nodeId, content, backupDir) {
  await mkdir(backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${nodeId}_${timestamp}.md`;
  const filepath = join(backupDir, filename);

  await writeFile(filepath, content, 'utf-8');
  return filepath;
}
