#!/usr/bin/env node
/**
 * DingTalk Message Service — OctoBus 服务包
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
    'dingtalk.message.v1.MessageService/SendDing': async (ctx) => {
      const { userId, content } = ctx.request;
      const cmd = `ding message send --user-ids ${shellEscape(userId)} --content ${shellEscape(content || '')}`;
      const res = await runDws(cmd);
      return { success: res.success, error: res.error };
    },

    'dingtalk.message.v1.MessageService/SendGroupMessage': async (ctx) => {
      const { groupId, chatId, content } = ctx.request;
      const conversationId = chatId || groupId;
      if (!conversationId) return { success: false, error: 'chatId or groupId required' };
      const cmd = `chat message send --conversation-id ${shellEscape(conversationId)} --content ${shellEscape(content || '')} --content-type text`;
      const res = await runDws(cmd);
      return { success: res.success, error: res.error };
    },

    'dingtalk.message.v1.MessageService/SendMail': async (ctx) => {
      const { to, subject, body } = ctx.request;
      const cmd = `mail message send --to ${shellEscape(to)} --subject ${shellEscape(subject || '')} --body ${shellEscape(body || '')}`;
      const res = await runDws(cmd);
      return { success: res.success, error: res.error };
    },
  },
});

runServiceMain(service);
