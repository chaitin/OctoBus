#!/usr/bin/env node
/**
 * DingTalk Todo Service — OctoBus 服务包
 * 封装 dws CLI 的待办操作
 */
import { defineService, runServiceMain } from '@chaitin-ai/octobus-sdk';
import { execFile } from 'child_process';

function runDws(command, timeout = 60000) {
  const dwsPath = process.env.DWS_PATH || 'dws';
  const escapedPath = `'${dwsPath.replace(/'/g, "'\\''")}'`;
  return new Promise((resolve) => {
    execFile('sh', ['-c', `${escapedPath} ${command} --yes --format json`], { timeout, maxBuffer: 10*1024*1024 },
      (error, stdout) => {
        const raw = stdout.trim();
        let data = null;
        try { data = JSON.parse(raw); } catch { data = raw; }
        if (error && error.code !== 0) resolve({ success: false, data, error: error.message });
        else resolve({ success: true, data, error: '' });
      });
  });
}

const shellEscape = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";

const service = defineService({
  handlers: {
    'dingtalk.todo.v1.TodoService/CreateTodo': async (ctx) => {
      const { title, description, dueDate, assigneeId } = ctx.request;
      // dws CLI flags: --title (required), --due (ISO-8601), --executors (required, userId comma-separated), --priority
      // dws does NOT have --description; embed it in the title if provided
      const displayTitle = description ? `${title || 'Untitled'} (${description})` : (title || 'Untitled');
      let cmd = `todo task create --title ${shellEscape(displayTitle)}`;
      if (dueDate) cmd += ` --due ${shellEscape(dueDate)}`;
      // executors is required by dws; use assigneeId, env USER_ID, or fallback
      const executor = assigneeId || process.env.USER_ID || 'default';
      if (!assigneeId && !process.env.USER_ID) {
        console.warn('[dingtalk-todo] assigneeId not provided and USER_ID not set, using "default"');
      }
      cmd += ` --executors ${shellEscape(executor)}`;

      const res = await runDws(cmd);
      if (!res.success) return { success: false, todoId: '', error: res.error };

      const r = res.data?.result || res.data;
      const todoId = Array.isArray(r) && r.length > 0 ? (r[0].id || r[0].taskId || '') : '';
      return { success: true, todoId, error: '' };
    },

    'dingtalk.todo.v1.TodoService/ListTodos': async (ctx) => {
      const { isDone, limit } = ctx.request;
      let cmd = `todo task list --size ${parseInt(limit || 10, 10)}`;
      if (isDone === true) cmd += ` --status true`;
      else if (isDone === false) cmd += ` --status false`;

      const res = await runDws(cmd);
      if (!res.success) return { success: false, todos: [], error: res.error };

      const rawList = res.data?.result?.todoList || res.data?.result || res.data?.todoList || [];
      const list = Array.isArray(rawList) ? rawList : [];
      const todos = list.map((t) => ({
        todoId: t.id || t.taskId || '',
        title: t.subject || t.title || '',
        description: t.description || '',
        isDone: t.done === true || t.isDone === true,
        dueDate: t.dueTime || t.dueDate || '',
        createdAt: t.createdTime || t.createdAt || '',
      }));
      return { success: true, todos, error: '' };
    },

    'dingtalk.todo.v1.TodoService/MarkDone': async (ctx) => {
      const { keyword } = ctx.request;
      // First list all pending todos
      const listRes = await runDws('todo task list --status false --size 50');
      if (!listRes.success) return { success: false, matchedCount: 0, error: listRes.error };

      const rawList = listRes.data?.result?.todoList || listRes.data?.result || [];
      const list = Array.isArray(rawList) ? rawList : [];

      let matched = 0;
      for (const t of list) {
        const subject = t.subject || t.title || '';
        if (keyword && subject.includes(keyword)) {
          const id = t.id || t.taskId;
          if (id) {
            await runDws(`todo task update --task-id ${shellEscape(id)} --done true`);
            matched++;
          }
        }
      }
      return { success: true, matchedCount: matched, error: '' };
    },
  },
});

runServiceMain(service);
