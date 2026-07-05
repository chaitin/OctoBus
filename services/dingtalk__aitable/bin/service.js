#!/usr/bin/env node
/**
 * DingTalk AI Table Service — OctoBus 服务包
 */
import { defineService, runServiceMain } from '@chaitin-ai/octobus-sdk';
import { execFile } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载看板配置（从 kanban.json 读取，避免 js-yaml 依赖）
let kanbanConfig = null;
function loadKanbanConfig(configPath) {
  if (kanbanConfig) return kanbanConfig;
  try {
    const resolved = configPath || join(__dirname, '..', 'config', 'kanban.json');
    const raw = readFileSync(resolved, 'utf-8');
    kanbanConfig = JSON.parse(raw);
  } catch (err) {
    console.error(`[aitable] Failed to load kanban.json: ${err.message}`);
    kanbanConfig = {};
  }
  return kanbanConfig;
}

function runDws(command, timeout = 60000) {
  const dwsPath = process.env.DWS_PATH || 'dws';
  return new Promise((resolve) => {
    execFile('sh', ['-c', `${dwsPath} ${command} --yes --format json`], { timeout, maxBuffer: 10*1024*1024 },
      (error, stdout) => {
        const raw = stdout.trim();
        let data = null;
        try { data = JSON.parse(raw); } catch { data = raw; }
        // dws 退出码 0 不代表业务成功，要看 data.status
        const status = data && typeof data === 'object' ? String(data.status || '').toLowerCase() : '';
        const businessFailed = status === 'error' || status === 'failed';
        if (error && error.code !== 0) {
          resolve({ success: false, data, error: (data && data.summary) || error.message });
        } else if (businessFailed) {
          const errMsg = (data && data.error && (data.error.message || data.error)) || (data && data.summary) || 'dws business error';
          resolve({ success: false, data, error: typeof errMsg === 'object' ? JSON.stringify(errMsg) : String(errMsg) });
        } else {
          resolve({ success: true, data, error: '' });
        }
      });
  });
}

const shellEscape = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";

const service = defineService({
  handlers: {
    'dingtalk.aitable.v1.AITableService/CreateRecord': async (ctx) => {
      const { baseId, tableId, fields } = ctx.request;
      // dws CLI expects --fields as array: [{"cells": {"fieldId": value, ...}}]
      // Values can be strings, or JSON-stringified objects/arrays for complex fields
      const cells = {};
      for (const [key, val] of Object.entries(fields || {})) {
        // Try to parse JSON strings back to objects/arrays for complex fields
        if (typeof val === 'string' && (val.startsWith('{') || val.startsWith('['))) {
          try { cells[key] = JSON.parse(val); } catch { cells[key] = val; }
        } else {
          cells[key] = val;
        }
      }
      const recordsArray = JSON.stringify([{ cells }]);
      const cmd = `aitable record create --base-id ${shellEscape(baseId)} --table-id ${shellEscape(tableId)} --fields ${shellEscape(recordsArray)}`;

      const res = await runDws(cmd);
      if (!res.success) return { success: false, recordId: '', error: res.error };

      // dws 把结果包在 data.data 里；newRecordIds 是新建记录 ID 列表
      const r = res.data?.data || res.data?.result || res.data;
      const recordId = (Array.isArray(r?.newRecordIds) && r.newRecordIds[0])
        || (Array.isArray(r) && r[0]?.recordId)
        || r?.recordId || '';
      return { success: true, recordId, error: '' };
    },

    'dingtalk.aitable.v1.AITableService/QueryRecords': async (ctx) => {
      const { baseId, tableId, limit } = ctx.request;
      const cmd = `aitable record list --base-id ${shellEscape(baseId)} --table-id ${shellEscape(tableId)} --limit ${shellEscape(String(parseInt(limit || 10, 10)))}`;

      const res = await runDws(cmd);
      if (!res.success) return { success: false, records: [], error: res.error };

      // dws 把结果包在 data.data.records；每条记录字段在 cells（不是 fields）
      const rawRecords = res.data?.data?.records || res.data?.result?.records || res.data?.records || [];
      const list = Array.isArray(rawRecords) ? rawRecords : [];
      const records = list.map((r) => ({
        recordId: r.recordId || r.id || '',
        fields: r.cells || r.fields || {},
      }));
      return { success: true, records, error: '' };
    },

    /**
     * 看板记录创建（业务封装）
     * 读 projects.yaml 的 kanban 配置，自动映射字段 ID → 构造 fields → 调用 CreateRecord
     */
    'dingtalk.aitable.v1.AITableService/CreateKanbanRecord': async (ctx) => {
      const { summary, category, customer, date, taskType, description, salesman, owner } = ctx.request;

      // 1. 加载配置
      const kanban = loadKanbanConfig(process.env.KANBAN_CONFIG_PATH);
      if (!kanban) {
        return { success: false, recordId: '', error: 'projects.yaml 中缺少 kanban 配置' };
      }

      // 2. 映射任务类型
      const taskTypes = kanban.task_types || {};
      let taskTypeOption = null;
      // 先精确匹配 taskType，再回退到 category
      const lookupKey = taskType || category;
      if (taskTypes[lookupKey]) {
        taskTypeOption = taskTypes[lookupKey];
      } else {
        // 模糊匹配：key 包含 category 的关键词
        for (const [key, val] of Object.entries(taskTypes)) {
          if (key.includes(lookupKey) || lookupKey.includes(key)) {
            taskTypeOption = val;
            break;
          }
        }
      }
      if (!taskTypeOption) {
        // 最终回退：用 category 本身作为名称
        taskTypeOption = { id: '', name: lookupKey };
      }

      // 3. 映射客户分类
      const customers = kanban.customers || {};
      let customerOption = null;
      if (customers[customer]) {
        customerOption = customers[customer];
      } else {
        // 模糊匹配：客户名中是否包含已知的 key
        for (const [key, val] of Object.entries(customers)) {
          if (customer.includes(key) || key.includes(customer)) {
            customerOption = val;
            break;
          }
        }
      }
      if (!customerOption && customer) {
        customerOption = { id: '', name: customer };
      }

      // 4. 提取二级部门（客户名中"-"后的部分）
      let department2 = '';
      if (customer && customer.includes('-')) {
        department2 = customer.split('-').slice(1).join('-');
      }

      // 5. 构造 fields
      const fields = {};
      // 日期字段（两个日期列）
      fields['5wlytmi'] = date || '';
      fields['5sxy4yq'] = date || '';
      // 任务类型
      fields['wiisqll'] = taskTypeOption;
      // 任务描述
      fields['q3aj1jn'] = summary || '';
      // 销售（kkcfjj6 = 销售字段）
      const salesUser = salesman || 'naiting.zang';
      fields['kkcfjj6'] = [{ userId: salesUser }];
      // Owner/执行人（6olqudb = Owner字段）
      const ownerUser = owner || 'jianhua.wang';
      fields['6olqudb'] = [{ userId: ownerUser }];
      // 周报摘要/说明
      fields['x2ysb28'] = description || summary || '';
      // 客户分类
      if (customerOption) {
        fields['dacnewp'] = customerOption;
      }
      // 二级部门
      if (department2) {
        fields['cgrfhw7'] = department2;
      }
      // 状态（固定：已完成）
      if (kanban.status_done) {
        fields['v5j63kh'] = kanban.status_done;
      }

      // 6. 调用 CreateRecord
      const cells = {};
      for (const [key, val] of Object.entries(fields)) {
        if (typeof val === 'object') {
          cells[key] = val;
        } else {
          // Try to parse JSON strings back to objects/arrays for complex fields
          if (typeof val === 'string' && (val.startsWith('{') || val.startsWith('['))) {
            try { cells[key] = JSON.parse(val); } catch { cells[key] = val; }
          } else {
            cells[key] = val;
          }
        }
      }
      const recordsArray = JSON.stringify([{ cells }]);
      const cmd = `aitable record create --base-id ${shellEscape(kanban.base_id)} --table-id ${shellEscape(kanban.table_id)} --fields ${shellEscape(recordsArray)}`;

      const res = await runDws(cmd);
      if (!res.success) return { success: false, recordId: '', error: res.error };

      const r = res.data?.data || res.data?.result || res.data;
      const recordId = (Array.isArray(r?.newRecordIds) && r.newRecordIds[0])
        || (Array.isArray(r) && r[0]?.recordId)
        || r?.recordId || '';
      return { success: true, recordId, error: '' };
    },
  },
});

runServiceMain(service);
