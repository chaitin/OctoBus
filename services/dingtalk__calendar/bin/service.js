#!/usr/bin/env node
/**
 * DingTalk Calendar Service — OctoBus 服务包
 */
import { defineService, runServiceMain } from '@chaitin-ai/octobus-sdk';
import { execFile } from 'child_process';

function runDws(command, timeout = 60000) {
  return new Promise((resolve) => {
    execFile('sh', ['-c', `dws ${command} --yes --format json`], { timeout, maxBuffer: 10*1024*1024 },
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
    'dingtalk.calendar.v1.CalendarService/ListEvents': async (ctx) => {
      const { start, end } = ctx.request;
      const res = await runDws(`calendar event list --start ${shellEscape(start)} --end ${shellEscape(end)}`);
      if (!res.success) return { success: false, events: [], error: res.error };

      const rawEvents = res.data?.result?.events || res.data?.events || [];
      const list = Array.isArray(rawEvents) ? rawEvents : [];
      const events = list.map((e) => ({
        id: e.id || '',
        summary: e.summary || '',
        start: e.start?.dateTime || e.start || '',
        end: e.end?.dateTime || e.end || '',
        isAllDay: e.isAllDay || false,
        description: e.description || '',
        location: e.location?.displayName || e.location || '',
        attendees: (e.attendees || []).map((a) => a.displayName || a.name || ''),
      }));
      return { success: true, events, error: '' };
    },

    'dingtalk.calendar.v1.CalendarService/CreateEvent': async (ctx) => {
      const { title, start, end, location, attendees } = ctx.request;
      let cmd = `calendar event create --title ${shellEscape(title || 'Untitled')} --start ${shellEscape(start)} --end ${shellEscape(end)}`;
      if (location) cmd += ` --location ${shellEscape(location)}`;
      if (attendees && attendees.length > 0) cmd += ` --attendees ${shellEscape(attendees.join(','))}`;

      const res = await runDws(cmd);
      if (!res.success) return { success: false, eventId: '', error: res.error };

      const r = res.data?.result || res.data;
      const eventId = r?.id || r?.eventId || (Array.isArray(r) && r[0]?.id) || '';
      return { success: true, eventId, error: '' };
    },
  },
});

runServiceMain(service);
