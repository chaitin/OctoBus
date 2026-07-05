/**
 * dws CLI 子进程封装
 * 移植自 Python 版本 src/core/dws.py
 *
 * 注意事项（踩坑记录）：
 * - 所有命令自动附加 --yes 跳过交互确认
 * - 临时文件必须用 UTF-8 无 BOM 写入
 * - doc update 需要 --mode overwrite + --content-file（不是 --text）
 * - 大文档（>10000字）不能用 overwrite，要用块级编辑
 */

import { execFile } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';

/**
 * 把字符串清洗为合法 UTF-8：lone surrogate 和非法序列替换为 U+FFFD。
 * 钉钉文档内容偶含 lone surrogate，若不清洗，agent 把内容转给 LLM 时
 * gRPC/protobuf 序列化会报 "string field contains invalid UTF-8" 导致整轮运行失败。
 * TextEncoder 会把 lone surrogate 编成 U+FFFD 字节，TextDecoder 再解回干净字符串。
 */
const sanitizeUtf8 = (s) => {
  if (typeof s !== 'string' || s === '') return s;
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(new TextEncoder().encode(s));
  } catch {
    return s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�');
  }
};

/** 递归清洗对象/数组/字符串中的所有字符串字段。 */
const sanitizeDeep = (value) => {
  if (typeof value === 'string') return sanitizeUtf8(value);
  if (Array.isArray(value)) return value.map(sanitizeDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = sanitizeDeep(value[k]);
    return out;
  }
  return value;
};


/**
 * 执行 dws CLI 命令
 * @param {string} command - dws 子命令（如 "doc read --node-id xxx"）
 * @param {object} options - 选项
 * @param {string} options.dwsPath - dws 可执行文件路径
 * @param {number} options.timeout - 超时毫秒数
 * @returns {Promise<{success: boolean, data: any, rawOutput: string, error: string}>}
 */
export async function runDws(command, options = {}) {
  const dwsPath = options.dwsPath || process.env.DWS_PATH || 'dws';
  const timeout = options.timeout || 60000;

  // 始终附加 --yes 跳过交互确认
  const fullCommand = `${command} --yes`;

  return new Promise((resolve) => {
    execFile('sh', ['-c', `${dwsPath} ${fullCommand}`], {
      timeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    }, (error, stdout, stderr) => {
      if (error && error.killed) {
        resolve({ success: false, data: null, rawOutput: '', error: `dws command timed out after ${timeout}ms` });
        return;
      }

      const rawOutput = sanitizeUtf8(stdout.trim());

      // 尝试解析 JSON 输出
      let data = null;
      try {
        data = JSON.parse(rawOutput);
        // 检查业务层错误
        if (data && data.success === false) {
          resolve({ success: false, data: sanitizeDeep(data), rawOutput, error: sanitizeUtf8(data.message || 'Business error') });
          return;
        }
      } catch {
        // 非 JSON 输出，返回原始文本
        data = rawOutput;
      }

      // 统一清洗 data 中的字符串，剔除 lone surrogate / 非法 UTF-8
      data = sanitizeDeep(data);

      if (error && error.code !== 0) {
        resolve({ success: false, data, rawOutput, error: sanitizeUtf8(stderr || error.message) });
        return;
      }

      resolve({ success: true, data, rawOutput, error: '' });
    });
  });
}

/**
 * 写入临时文件（UTF-8 无 BOM）
 * 移植自 Python 版本的 mode="wb" + .encode("utf-8")
 */
export async function writeTempFile(content) {
  const suffix = randomBytes(4).toString('hex');
  const filePath = join(tmpdir(), `dws-temp-${suffix}.md`);
  // Node.js Buffer.from(string, 'utf8') 不带 BOM；先清洗 lone surrogate 保证写入合法 UTF-8
  await writeFile(filePath, Buffer.from(sanitizeUtf8(content), 'utf8'));
  return filePath;
}

/**
 * 清理临时文件
 */
export async function cleanupTempFile(filePath) {
  try {
    await unlink(filePath);
  } catch {
    // 忽略清理失败
  }
}

/**
 * Shell 转义
 */
export function shellEscape(str) {
  return `'${str.replace(/'/g, "'\\''")}'`;
}
