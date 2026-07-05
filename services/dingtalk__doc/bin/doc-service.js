#!/usr/bin/env node
/**
 * DingTalk Document Service - OctoBus 服务包入口
 *
 * 封装钉钉文档的所有操作：
 * - 文档读写（ReadDoc / UpdateDoc / CreateDoc）
 * - 倒序插入简报（InsertBrief - 复合方法）
 * - 块级操作（ListBlocks / UpdateBlock / InsertBlockAfter）
 * - 搜索（SearchDocs）
 * - 上下文记忆（GetLastContext）
 *
 * 关键设计决策：
 * - InsertBrief 是复合方法，内部封装了记忆读取、备份、安全校验、插入全流程
 * - Agent 只需调用一次 InsertBrief，不需要关心文档操作细节
 * - 所有 dws 操作经过 dws-runner.js 封装，统一处理错误和超时
 */

import { defineService, runServiceMain } from '@chaitin-ai/octobus-sdk';
import { runDws, writeTempFile, cleanupTempFile, shellEscape } from '../lib/dws-runner.js';
import { DocMemory } from '../lib/doc-memory.js';
import { safetyCheck, cleanHtmlTags, backupDocument } from '../lib/safety-check.js';

// 服务配置（从 OctoBus instance config 注入）
const config = {
  dwsPath: process.env.DWS_PATH || 'dws',
  stateDataDir: process.env.STATE_DATA_DIR || './data',
  backupDir: process.env.BACKUP_DIR || './backups',
  maxDocSize: parseInt(process.env.MAX_DOC_SIZE || '10000'),
  dwsTimeout: parseInt(process.env.DWS_TIMEOUT || '60000'),
};

const docMemory = new DocMemory(config.stateDataDir);

const service = defineService({
  handlers: {
    /**
     * 读取文档全文
     */
    'dingtalk.doc.v1.DocService/ReadDoc': async (ctx) => {
      const { nodeId } = ctx.request;
      const result = await runDws(
        `doc read --node-id ${nodeId}`,
        { dwsPath: config.dwsPath, timeout: config.dwsTimeout }
      );
      // dws doc read 返回 JSON 对象: {markdown, nodeId, docUrl, ...}
      const raw = result.data;
      const markdown = result.success
        ? (typeof raw === 'object' && raw !== null ? (raw.markdown || raw.content || '') : String(raw || ''))
        : '';
      return {
        success: result.success,
        content: markdown,
        error: result.error,
      };
    },

    /**
     * 全文覆盖更新（<10000字）
     */
    'dingtalk.doc.v1.DocService/UpdateDoc': async (ctx) => {
      const { nodeId, content } = ctx.request;

      // 清理 HTML 标签
      const cleanContent = cleanHtmlTags(content);

      // 写入临时文件
      const tmpFile = await writeTempFile(cleanContent);
      try {
        const result = await runDws(
          `doc update --node-id ${nodeId} --mode overwrite --content-file ${shellEscape(tmpFile)}`,
          { dwsPath: config.dwsPath, timeout: config.dwsTimeout }
        );
        return { success: result.success, error: result.error };
      } finally {
        await cleanupTempFile(tmpFile);
      }
    },

    /**
     * 创建新文档
     */
    'dingtalk.doc.v1.DocService/CreateDoc': async (ctx) => {
      const { title, content, parentFolder } = ctx.request;

      const tmpFile = await writeTempFile(content || '');
      try {
        let cmd = `doc create --title ${shellEscape(title)} --content-file ${shellEscape(tmpFile)}`;
        if (parentFolder) {
          cmd += ` --folder-id ${parentFolder}`;
        }
        const result = await runDws(cmd, { dwsPath: config.dwsPath, timeout: config.dwsTimeout });

        // 从返回中提取 nodeId 和 url
        const nodeId = result.data?.nodeId || result.data?.node_id || '';
        const url = result.data?.url || '';

        return { success: result.success, nodeId, url, error: result.error };
      } finally {
        await cleanupTempFile(tmpFile);
      }
    },

    /**
     * 倒序插入简报（核心复合方法）
     *
     * 流程：
     * 1. 读取 doc_memory → 获取 header 位置
     * 2. 读取当前文档全文
     * 3. 备份原文档
     * 4. 安全校验（新内容不能太短）
     * 5. 在 header 后倒序插入新简报
     * 6. 写回文档
     * 7. 更新 doc_memory
     */
    'dingtalk.doc.v1.DocService/InsertBrief': async (ctx) => {
      const { nodeId, briefContent, title } = ctx.request;

      try {
        // 1. 读取记忆
        const memory = await docMemory.get(nodeId);
        const headerLength = memory?.header_length;

        // 2. 读取文档
        const readResult = await runDws(
          `doc read --node-id ${nodeId}`,
          { dwsPath: config.dwsPath, timeout: config.dwsTimeout }
        );
        if (!readResult.success) {
          return { success: false, error: `读取文档失败: ${readResult.error}` };
        }

        const originalContent = (() => {
          const raw = readResult.data;
          if (typeof raw === 'object' && raw !== null) {
            return raw.markdown || raw.content || JSON.stringify(raw);
          }
          return String(raw || '');
        })();

        // 3. 备份
        const backupPath = await backupDocument(nodeId, originalContent, config.backupDir);

        // 4. 安全校验
        const headerEnd = headerLength ?? DocMemory.findHeaderEnd(originalContent);
        const header = originalContent.substring(0, headerEnd);
        const body = originalContent.substring(headerEnd);
        const newContent = header + '\n' + briefContent + '\n\n' + body;

        const check = safetyCheck(originalContent, newContent);
        if (!check.safe) {
          return { success: false, error: `安全校验失败: ${check.reason}` };
        }

        // 5. 写回文档
        const cleanContent = cleanHtmlTags(newContent);
        const tmpFile = await writeTempFile(cleanContent);
        try {
          const writeResult = await runDws(
            `doc update --node-id ${nodeId} --mode overwrite --content-file ${shellEscape(tmpFile)}`,
            { dwsPath: config.dwsPath, timeout: config.dwsTimeout }
          );
          if (!writeResult.success) {
            return { success: false, backupPath, error: `写入文档失败: ${writeResult.error}` };
          }
        } finally {
          await cleanupTempFile(tmpFile);
        }

        // 6. 更新记忆
        await docMemory.set(nodeId, {
          headerLength: headerEnd,
          lastBriefTitle: title,
        });

        return { success: true, backupPath, error: '' };
      } catch (err) {
        return { success: false, error: `InsertBrief 异常: ${err.message}` };
      }
    },

    /**
     * 列出文档块
     */
    'dingtalk.doc.v1.DocService/ListBlocks': async (ctx) => {
      const { nodeId, startIndex, endIndex } = ctx.request;
      const result = await runDws(
        `doc block list --node ${nodeId} --start-index ${startIndex} --end-index ${endIndex}`,
        { dwsPath: config.dwsPath, timeout: config.dwsTimeout }
      );

      if (!result.success) {
        return { success: false, blocks: [], error: result.error };
      }

      // dws 返回 {blocks: [{blockType, element: {id, index, heading/paragraph}}], totalCount, success}
      const rawBlocks = (result.data && typeof result.data === 'object' && Array.isArray(result.data.blocks))
        ? result.data.blocks : [];
      const blocks = rawBlocks.map((b) => {
        const el = b.element || b;
        const heading = el.heading || {};
        const paragraph = el.paragraph || {};
        const orderedList = el.orderedList || {};
        const content = heading.text || paragraph.text || orderedList.text || el.text || '';
        const levelStr = heading.level || '';
        const level = typeof levelStr === 'string' ? parseInt(levelStr.replace('heading-', '') || '0') : (levelStr || 0);
        return {
          blockId: el.id || '',
          index: el.index ?? b.index ?? 0,
          blockType: b.blockType || el.blockType || '',
          content,
          level,
        };
      });

      return { success: true, blocks, error: '' };
    },

    /**
     * 更新块内容
     */
    'dingtalk.doc.v1.DocService/UpdateBlock': async (ctx) => {
      const { nodeId, blockId, content } = ctx.request;
      const tmpFile = await writeTempFile(content);
      try {
        const result = await runDws(
          `doc block update --node ${nodeId} --block-id ${blockId} --content-file ${shellEscape(tmpFile)}`,
          { dwsPath: config.dwsPath, timeout: config.dwsTimeout }
        );
        return { success: result.success, error: result.error };
      } finally {
        await cleanupTempFile(tmpFile);
      }
    },

    /**
     * 在指定块之后插入新块
     */
    'dingtalk.doc.v1.DocService/InsertBlockAfter': async (ctx) => {
      const { nodeId, afterBlockId, blockType, content, level } = ctx.request;
      const tmpFile = await writeTempFile(content);
      try {
        let cmd = `doc block insert --node ${nodeId} --after-block-id ${afterBlockId} --type ${blockType} --content-file ${shellEscape(tmpFile)}`;
        if (level && blockType === 'heading') {
          cmd += ` --level ${level}`;
        }
        const result = await runDws(cmd, { dwsPath: config.dwsPath, timeout: config.dwsTimeout });
        const newBlockId = result.data?.blockId || result.data?.id || '';
        return { success: result.success, newBlockId, error: result.error };
      } finally {
        await cleanupTempFile(tmpFile);
      }
    },

    /**
     * 搜索文档
     */
    'dingtalk.doc.v1.DocService/SearchDocs': async (ctx) => {
      const { keyword, maxResults } = ctx.request;
      const limit = maxResults || 10;
      const result = await runDws(
        `doc search --keyword ${shellEscape(keyword)} --limit ${limit}`,
        { dwsPath: config.dwsPath, timeout: config.dwsTimeout }
      );

      if (!result.success) {
        return { success: false, results: [], error: result.error };
      }

      // dws 返回 {documents: [{name, nodeId, docUrl, contentType}], hasMore, success}
      const rawDocs = (result.data && typeof result.data === 'object' && Array.isArray(result.data.documents))
        ? result.data.documents : [];
      const results = rawDocs.map((d) => ({
        nodeId: d.nodeId || '',
        title: d.name || d.title || '',
        url: d.docUrl || d.url || '',
        snippet: d.description || '',
      }));

      return { success: true, results, error: '' };
    },

    /**
     * 获取上次交流上下文
     */
    'dingtalk.doc.v1.DocService/GetLastContext': async (ctx) => {
      const { nodeId, maxLength } = ctx.request;
      const maxLen = maxLength || 800;

      try {
        const memory = await docMemory.get(nodeId);
        if (!memory?.last_brief_title) {
          return { success: true, context: '', lastTitle: '', error: '' };
        }

        // 读取文档，找到上次简报
        const readResult = await runDws(
          `doc read --node-id ${nodeId}`,
          { dwsPath: config.dwsPath, timeout: config.dwsTimeout }
        );
        if (!readResult.success) {
          return { success: false, context: '', lastTitle: memory.last_brief_title, error: readResult.error };
        }

        const content = (() => {
          const raw = readResult.data;
          if (typeof raw === 'object' && raw !== null) {
            return raw.markdown || raw.content || JSON.stringify(raw);
          }
          return String(raw || '');
        })();
        const titleIdx = content.indexOf(memory.last_brief_title);
        if (titleIdx === -1) {
          return { success: true, context: '', lastTitle: memory.last_brief_title, error: '上次简报标题未找到' };
        }

        // 提取上次简报内容（到下一个同级标题或末尾）
        const afterTitle = content.substring(titleIdx);
        const nextHeading = afterTitle.indexOf('\n# ', 1);
        const context = nextHeading > 0
          ? afterTitle.substring(0, Math.min(nextHeading, maxLen))
          : afterTitle.substring(0, maxLen);

        return { success: true, context, lastTitle: memory.last_brief_title, error: '' };
      } catch (err) {
        return { success: false, context: '', lastTitle: '', error: err.message };
      }
    },

    /**
     * 周会记录同步（移植自 Python weekly_sync.py）
     *
     * 流程：
     * 1. 分批获取文档块（每批200个）
     * 2. 从本周一开始，逐周查找目标周标题（heading-2 含日期）
     * 3. 在周标题下查找 userName（orderedList.text 匹配）
     * 4. 找到后收集分类块，更新计数并插入条目
     * 5. 若所有周标题下都没找到 userName → savedForLater=true
     */
    'dingtalk.doc.v1.DocService/SyncWeekly': async (ctx) => {
      const { nodeId, userName, entries } = ctx.request;

      if (!entries || entries.length === 0) {
        return { success: true, weekId: '', syncedCount: 0, savedForLater: false, error: '' };
      }

      // ── 辅助函数 ──
      const listBlocks = async (start, end) => {
        const result = await runDws(
          `doc block list --node ${nodeId} --start-index ${start} --end-index ${end}`,
          { dwsPath: config.dwsPath, timeout: config.dwsTimeout }
        );
        if (!result.success) return [];
        const rawBlocks = (result.data && typeof result.data === 'object' && Array.isArray(result.data.blocks))
          ? result.data.blocks : [];
        return rawBlocks.map((b) => {
          const el = b.element || b;
          const heading = el.heading || {};
          const paragraph = el.paragraph || {};
          const orderedList = el.orderedList || {};
          return {
            blockId: el.id || '',
            index: el.index ?? b.index ?? 0,
            blockType: b.blockType || el.blockType || '',
            content: heading.text || paragraph.text || orderedList.text || el.text || '',
            level: (() => {
              const lv = heading.level || '';
              return typeof lv === 'string' ? parseInt(lv.replace('heading-', '') || '0') : (lv || 0);
            })(),
          };
        });
      };

      const updateBlock = async (blockId, text) => {
        const safeText = shellEscape(text);
        const result = await runDws(
          `doc block update --node ${nodeId} --block-id ${blockId} --type orderedList --text ${safeText} --fix-jsonml`,
          { dwsPath: config.dwsPath, timeout: config.dwsTimeout }
        );
        return result.success;
      };

      const insertBlockAfter = async (refBlockId, text) => {
        const safeText = shellEscape(text);
        const result = await runDws(
          `doc block insert --node ${nodeId} --ref-block ${refBlockId} --type orderedList --text ${safeText} --fix-jsonml`,
          { dwsPath: config.dwsPath, timeout: config.dwsTimeout }
        );
        return result.success;
      };

      // ── 1. 分批获取所有块 ──
      const allBlocks = [];
      const BATCH_SIZE = 200;
      for (let start = 0; start < 2000; start += BATCH_SIZE) {
        const batch = await listBlocks(start, start + BATCH_SIZE);
        if (batch.length === 0) break;
        allBlocks.push(...batch);
        if (batch.length < BATCH_SIZE) break;
      }
      if (allBlocks.length === 0) {
        return { success: false, weekId: '', syncedCount: 0, savedForLater: false, error: '无法获取文档块' };
      }

      // ── 2. 计算目标周日期（本周一） ──
      const now = new Date();
      const cstOffset = 8 * 60 * 60 * 1000;
      const cstNow = new Date(now.getTime() + cstOffset);
      const dayOfWeek = cstNow.getUTCDay(); // 0=Sun, 1=Mon
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monday = new Date(cstNow.getTime() + mondayOffset * 24 * 60 * 60 * 1000);
      const targetWeekId = monday.toISOString().slice(0, 10); // YYYY-MM-DD

      // ── 3. 找到所有周标题 ──
      const weekHeaders = []; // {index, weekId, blockId}
      const dateRegex = /^(\d{4}-\d{2}-\d{2})/;
      for (let i = 0; i < allBlocks.length; i++) {
        const b = allBlocks[i];
        if (b.blockType === 'heading' && b.level === 2) {
          const m = b.content.match(dateRegex);
          if (m) {
            weekHeaders.push({ index: i, weekId: m[1], blockId: b.blockId });
          }
        }
      }

      // 按日期排序，优先找 >= targetWeekId 的周标题
      weekHeaders.sort((a, b) => a.weekId.localeCompare(b.weekId));
      const candidateWeeks = weekHeaders.filter(w => w.weekId >= targetWeekId);
      const weeksToSearch = candidateWeeks.length > 0 ? candidateWeeks : weekHeaders;

      if (weeksToSearch.length === 0) {
        return { success: false, weekId: '', syncedCount: 0, savedForLater: true, error: '文档中无周标题' };
      }

      // ── 4. 逐周查找 userName ──
      const CATEGORY_KEYWORDS = {
        'Communication': 'Communication',
        'Documentation': 'Documentation',
        'Bidding': 'Bidding',
        'POC & Others': 'POC & Others',
      };

      for (const week of weeksToSearch) {
        // 确定本周标题的范围（到下一个周标题或文档末尾）
        const weekEnd = weekHeaders.find(w => w.weekId > week.weekId)?.index ?? allBlocks.length;

        // 在周范围内找 userName
        let userNameIdx = null;
        for (let i = week.index + 1; i < weekEnd; i++) {
          const b = allBlocks[i];
          if (b.blockType === 'orderedList' && b.content.trim() === userName) {
            userNameIdx = i;
            break;
          }
        }
        if (userNameIdx === null) { continue; }

        // ── 5. 从 userName 开始收集分类块 ──
        const categories = {}; // { categoryName: { headerBlockId, entryBlockIds: [] } }
        let currentCat = null;

        for (let i = userNameIdx + 1; i < weekEnd; i++) {
          const b = allBlocks[i];
          if (b.blockType === 'heading') break; // 遇到下一个周标题

          if (b.blockType === 'orderedList') {
            const text = b.content.trim();

            // 遇到下一个人名（2-4个汉字，不是分类关键词，不是"近1周"/"本周计划"）
            if (/^[一-鿿]{2,4}$/.test(text) &&
                text !== userName && text !== '近1周' && text !== '本周计划' &&
                !text.startsWith('【')) {
              break;
            }

            // 遇到"本周计划"则停止
            if (text.startsWith('本周计划')) break;

            // 检查是否是分类标题
            let foundCat = false;
            for (const [catName, keyword] of Object.entries(CATEGORY_KEYWORDS)) {
              if (text.includes(keyword)) {
                categories[catName] = { headerBlockId: b.blockId, entryBlockIds: [] };
                currentCat = catName;
                foundCat = true;
                break;
              }
            }

            // 非分类标题 → 属于当前分类的条目
            if (!foundCat && currentCat && categories[currentCat]) {
              categories[currentCat].entryBlockIds.push(b.blockId);
            }
          }
        }

        if (Object.keys(categories).length === 0) { continue; }

        // ── 6. 按分类分组 entries ──
        const grouped = {};
        for (const entry of entries) {
          let cat = 'Communication';
          for (const catName of Object.keys(CATEGORY_KEYWORDS)) {
            if (entry.category && entry.category.includes(catName)) {
              cat = catName;
              break;
            }
          }
          if (!grouped[cat]) grouped[cat] = [];
          grouped[cat].push(entry.summary);
        }

        // ── 7. 更新每个分类 ──
        let syncedCount = 0;

        for (const [catName, summaries] of Object.entries(grouped)) {
          if (!categories[catName]) { continue; }
          const catInfo = categories[catName];

          // 更新分类标题计数
          const newHeader = `【${catName}*${summaries.length}】`;

          // 插入条目
          for (const summary of summaries) {
            const refId = catInfo.entryBlockIds.length > 0
              ? catInfo.entryBlockIds[catInfo.entryBlockIds.length - 1]
              : catInfo.headerBlockId;
            const ok = await insertBlockAfter(refId, summary);
            if (ok) {
              syncedCount++;
              catInfo.entryBlockIds.push('newly-inserted'); // track for subsequent inserts
            }
          }
        }

        return { success: syncedCount > 0, weekId: week.weekId, syncedCount, savedForLater: false, error: '' };
      }

      // ── 所有周标题下都没找到 userName → 留存 ──
      return { success: false, weekId: '', syncedCount: 0, savedForLater: true, error: `在所有周标题下均未找到「${userName}」` };
    },

    /**
     * 移动文档到指定文件夹（整理归档用）
     * 封装 dws doc move --node <nodeId> --folder <targetFolderId>
     */
    'dingtalk.doc.v1.DocService/MoveDoc': async (ctx) => {
      const { nodeId, targetFolderId } = ctx.request;
      if (!nodeId || !targetFolderId) {
        return { success: false, error: 'node_id 和 target_folder_id 都必填' };
      }
      const result = await runDws(
        `doc move --node ${shellEscape(nodeId)} --folder ${shellEscape(targetFolderId)}`,
        { dwsPath: config.dwsPath, timeout: config.dwsTimeout }
      );
      return { success: result.success, error: result.error };
    },

    /**
     * 创建文件夹
     * 封装 dws doc folder create --name <name> [--folder <parentFolderId>]
     */
    'dingtalk.doc.v1.DocService/CreateFolder': async (ctx) => {
      const { name, parentFolderId } = ctx.request;
      if (!name) {
        return { success: false, folderId: '', error: 'name 必填' };
      }
      let cmd = `doc folder create --name ${shellEscape(name)}`;
      if (parentFolderId) {
        cmd += ` --folder ${shellEscape(parentFolderId)}`;
      }
      const result = await runDws(cmd, { dwsPath: config.dwsPath, timeout: config.dwsTimeout });
      const folderId = result.data?.nodeId || result.data?.node_id || result.data?.id || '';
      return { success: result.success, folderId, error: result.error };
    },

    /**
     * 列出文件夹下的文档节点（folder_id 空=根目录），用于查找散落文档做整理归档
     * 封装 dws doc list [--folder <folderId>] [--page-size N]
     */
    'dingtalk.doc.v1.DocService/ListDocs': async (ctx) => {
      const { folderId, pageSize } = ctx.request;
      let cmd = `doc list`;
      if (folderId) {
        cmd += ` --folder ${shellEscape(folderId)}`;
      }
      if (pageSize && pageSize > 0) {
        cmd += ` --page-size ${pageSize}`;
      }
      const result = await runDws(cmd, { dwsPath: config.dwsPath, timeout: config.dwsTimeout });
      const rawItems = result.data?.nodes || result.data?.items || (Array.isArray(result.data) ? result.data : []);
      const docs = (Array.isArray(rawItems) ? rawItems : []).map((it) => ({
        nodeId: it.nodeId || it.node_id || it.id || '',
        title: it.name || it.title || '',
        type: (it.nodeType || it.node_type || '').includes('folder') ? 'folder' : 'doc',
        url: it.docUrl || it.url || '',
      }));
      return {
        success: result.success,
        docs,
        nextPageToken: result.data?.nextPageToken || result.data?.next_page_token || '',
        error: result.error,
      };
    },
  },
});

runServiceMain(service);
