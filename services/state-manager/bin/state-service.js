#!/usr/bin/env node
/**
 * Agent State Manager - OctoBus Service Entry Point
 *
 * Capability modules (28 RPCs):
 * 1. Project Config — read projects.yaml, provide query/match (3 RPCs)
 * 2. Weekly Buffer — accumulate summaries, clear after sync (3 RPCs, delegated to memory engine commitment type)
 * 3. Meeting Tracking — register meetings, track state, query pending (3 RPCs, delegated to memory engine commitment type)
 * 4. User Config — read user-config.json personal config (1 RPC)
 * 5. Memory Engine — Remember/Recall/Forget + stats (4 RPCs)
 * 6. Distillation Engine — action_log compression + session summary + correction management (2 RPCs)
 * 7. Task State Machine — task lifecycle + step tracking + timeout detection (6 RPCs)
 * 8. Event Log — append-only event records + range queries (3 RPCs)
 * 9. General Storage — simple key-value store (backward-compatible API) (2 RPCs)
 *
 * OctoBus service display name mapping:
 *   state-manager     → Agent State Manager (this package)
 *   dingtalk-aitable  → DingTalk AITable
 *   dingtalk-calendar → DingTalk Calendar
 *   dingtalk-doc      → DingTalk Doc
 *   dingtalk-message  → DingTalk Message
 *   dingtalk-todo     → DingTalk Todo
 */

import { defineService, runServiceMain } from '@chaitin-ai/octobus-sdk';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { StorageAdapter } from '../lib/storage-adapter.js';
import { MemoryIndex } from '../lib/memory-index.js';
import { TTLManager } from '../lib/ttl-manager.js';
import { MemoryEngine } from '../lib/memory-engine.js';
import { DistillationEngine } from '../lib/distillation-engine.js';
import { TaskMachine } from '../lib/task-machine.js';
import { EventLog } from '../lib/event-log.js';

// ====== Config ======
const config = {
  dataDir: process.env.DATA_DIR || './data',
  projectsConfigPath: process.env.PROJECTS_CONFIG_PATH || process.env.PROJECTS_CONFIG || './config/projects.yaml',
  userConfigPath: process.env.USER_CONFIG_PATH || process.env.USER_CONFIG || './config/user-config.json',
};

// ====== Project Config Cache ======
let projectsCache = null;
let projectsCacheTime = 0;
const CACHE_TTL = 60000; // 1 minute

async function loadProjects() {
  const now = Date.now();
  if (projectsCache && (now - projectsCacheTime) < CACHE_TTL) {
    return projectsCache;
  }

  const yaml = await import('js-yaml');
  const raw = await readFile(config.projectsConfigPath, 'utf-8');
  const parsed = yaml.load(raw);

  projectsCache = parsed;
  projectsCacheTime = now;
  return parsed;
}

// ====== JSON Persistence Helpers ======
async function loadJSON(filePath, defaultValue = {}) {
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return defaultValue;
  }
}

async function saveJSON(filePath, data) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ====== Meeting State Machine (migrated to memory engine, this constant is for internal filtering only) ======
const VALID_MEETING_STATES = ['registered', 'notes_submitted', 'doc_created', 'reminded'];

// ====== Memory Engine (global singleton) ======
const storageAdapter = new StorageAdapter(config.dataDir);
const memoryIndex = new MemoryIndex();
const ttlManager = new TTLManager(memoryIndex, storageAdapter);
const memoryEngine = new MemoryEngine(memoryIndex, storageAdapter, ttlManager);

// ====== Distillation Engine ======
const distillationEngine = new DistillationEngine(memoryEngine);

// ====== Task State Machine ======
const taskMachine = new TaskMachine(config.dataDir);

// ====== Event Log ======
const eventLog = new EventLog(config.dataDir);

// ====== Startup Initialization ======
async function initialize() {
  // 1. Load tenant/userId from user-config
  await memoryEngine.loadIdentity(config.userConfigPath);

  // 2. Load existing memories from files into index
  const allEntries = await storageAdapter.loadAll();
  memoryIndex.rebuild(allEntries);

  // 3. Start TTL background scan
  ttlManager.start();

  // 4. Initialize task state machine
  await taskMachine.initialize();

  // 5. Initialize event log
  await eventLog.initialize();

  console.log(`[MemoryEngine] initialized: tenant=${memoryEngine.tenant}, user=${memoryEngine.userId}, entries=${memoryIndex.entries.size}`);
  console.log(`[TaskMachine] ${taskMachine.tasks.size} tasks, [EventLog] ${eventLog.events.length} events`);
}

// Initialization (runs immediately after service start)
const initPromise = initialize();

// ====== Service Definition ======
const service = defineService({
  handlers: {

    // ====== Project Config ======

    /**
     * Get project config by key
     */
    'state.manager.v1.StateManagerService/GetProject': async (ctx) => {
      const { key } = ctx.request;
      try {
        const parsed = await loadProjects();
        const projects = parsed.projects || {};
        const proj = projects[key];
        if (!proj) {
          return { success: false, error: `Project "${key}" not found` };
        }
        return {
          success: true,
          project: {
            key,
            name: proj.name || '',
            nodeId: proj.node_id || '',
            customer: proj.customer || '',
            keywords: proj.keywords || [],
            detailFolder: proj.detail_folder || '',
            background: proj.background || '',
          },
          error: '',
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },

    /**
     * List all projects
     */
    'state.manager.v1.StateManagerService/ListProjects': async () => {
      try {
        const parsed = await loadProjects();
        const projects = parsed.projects || {};
        const list = Object.entries(projects).map(([key, proj]) => ({
          key,
          name: proj.name || '',
          nodeId: proj.node_id || '',
          customer: proj.customer || '',
          keywords: proj.keywords || [],
          detailFolder: proj.detail_folder || '',
          background: proj.background || '',
        }));
        return { success: true, projects: list, error: '' };
      } catch (err) {
        return { success: false, projects: [], error: err.message };
      }
    },

    /**
     * Match project by keywords
     * Ported from Python doc_creator.py match_customer_to_project()
     */
    'state.manager.v1.StateManagerService/MatchProject': async (ctx) => {
      const { text } = ctx.request;
      try {
        const parsed = await loadProjects();
        const projects = parsed.projects || {};

        let bestMatch = null;
        let bestScore = 0;

        for (const [key, proj] of Object.entries(projects)) {
          const keywords = proj.keywords || [];
          for (const kw of keywords) {
            if (text.includes(kw)) {
              const score = kw.length / Math.max(text.length, 1);
              if (score > bestScore) {
                bestScore = score;
                bestMatch = {
                  key,
                  name: proj.name || '',
                  nodeId: proj.node_id || '',
                  customer: proj.customer || '',
                  keywords,
                  detailFolder: proj.detail_folder || '',
                  background: proj.background || '',
                };
              }
            }
          }
        }

        return {
          success: true,
          project: bestMatch || { key: '', name: '', nodeId: '', customer: '', keywords: [], detailFolder: '', background: '' },
          confidence: bestMatch ? Math.min(bestScore * 5, 1.0) : 0,
          error: '',
        };
      } catch (err) {
        return { success: false, confidence: 0, error: err.message };
      }
    },

    // ====== Weekly Pending Buffer (migrated to memory engine commitment type) ======

    /**
     * Add a pending weekly summary item
     * Internally delegates to Remember(type=commitment, key=weekly_item:{date}:{hash})
     */
    'state.manager.v1.StateManagerService/AddPendingItem': async (ctx) => {
      await initPromise;
      const { summary, category, date } = ctx.request;
      const itemDate = date || new Date().toISOString().slice(0, 10);
      const itemCategory = category || 'Communication';
      const key = `weekly_item:${itemDate}:${(summary || '').slice(0, 20)}`;
      const value = JSON.stringify({
        summary: summary || '',
        category: itemCategory,
        date: itemDate,
      });

      try {
        const result = await memoryEngine.remember({
          type: 'commitment',
          key,
          value,
          ttl_seconds: 30 * 86400, // 30 days
        });

        // Count current pending total
        const all = await memoryEngine.recall({ prefix: 'weekly_item:', type: 'commitment', limit: 100 });

        return { success: result.success, pendingCount: all.entries.length, error: result.error || '' };
      } catch (err) {
        return { success: false, pendingCount: 0, error: err.message };
      }
    },

    /**
     * Get all pending sync items
     * Internally delegates to Recall(prefix=weekly_item:, type=commitment)
     */
    'state.manager.v1.StateManagerService/GetPendingItems': async () => {
      await initPromise;
      try {
        const result = await memoryEngine.recall({ prefix: 'weekly_item:', type: 'commitment', limit: 100 });
        const items = (result.entries || []).map((entry) => {
          try {
            const parsed = JSON.parse(entry.value);
            return {
              summary: parsed.summary || '',
              category: parsed.category || '',
              date: parsed.date || '',
            };
          } catch {
            return { summary: entry.value || '', category: '', date: '' };
          }
        });
        return { success: true, items, error: '' };
      } catch (err) {
        return { success: false, items: [], error: err.message };
      }
    },

    /**
     * Clear pending buffer (called after successful sync)
     * Internally delegates to Forget(prefix=weekly_item:, type=commitment) + records last_synced
     */
    'state.manager.v1.StateManagerService/ClearPending': async () => {
      await initPromise;
      try {
        // Get current entry count (for returning clearedCount)
        const all = await memoryEngine.recall({ prefix: 'weekly_item:', type: 'commitment', limit: 100 });
        const clearedCount = all.entries.length;

        // Batch delete all weekly_item entries
        await memoryEngine.forget({ prefix: 'weekly_item:', type: 'commitment' });

        // Record last_synced time
        await memoryEngine.remember({
          type: 'commitment',
          key: 'weekly:last_synced',
          value: JSON.stringify({ last_synced: new Date().toISOString() }),
          ttl_seconds: 30 * 86400,
        });

        return { success: true, clearedCount, error: '' };
      } catch (err) {
        return { success: false, clearedCount: 0, error: err.message };
      }
    },

    // ====== Meeting Tracking (migrated to memory engine commitment type) ======

    /**
     * Register a meeting
     * Internally delegates to Remember(type=commitment, key=meeting:{eventId})
     */
    'state.manager.v1.StateManagerService/RegisterMeeting': async (ctx) => {
      await initPromise;
      const { eventId, summary, startTime, endTime, attendees } = ctx.request;

      try {
        // Check if already exists
        const existing = await memoryEngine.recall({ key: `meeting:${eventId}`, type: 'commitment' });

        if (existing.entries && existing.entries.length > 0) {
          // Already exists, skip but update last_check
          return { success: true, isNew: false, error: '' };
        }

        // New meeting, write to memory engine
        const value = JSON.stringify({
          eventId: eventId || '',
          summary: summary || '',
          startTime: startTime || '',
          endTime: endTime || '',
          attendees: attendees || [],
          state: 'registered',
          registeredAt: new Date().toISOString(),
        });

        await memoryEngine.remember({
          type: 'commitment',
          key: `meeting:${eventId}`,
          value,
          ttl_seconds: 30 * 86400, // 30 days
        });

        return { success: true, isNew: true, error: '' };
      } catch (err) {
        return { success: false, isNew: false, error: err.message };
      }
    },

    /**
     * Get pending meetings (ended but no minutes submitted yet)
     * Internally delegates to Recall(prefix=meeting:, type=commitment) + filtering
     */
    'state.manager.v1.StateManagerService/GetPendingMeetings': async (ctx) => {
      await initPromise;
      const graceHours = ctx.request.graceHours || 24;

      try {
        const result = await memoryEngine.recall({ prefix: 'meeting:', type: 'commitment', limit: 200 });
        const now = new Date();
        const graceMs = graceHours * 3600 * 1000;

        const meetings = (result.entries || [])
          .map((entry) => {
            try {
              return JSON.parse(entry.value);
            } catch {
              return null;
            }
          })
          .filter((m) => {
            if (!m || m.state !== 'registered') return false;
            if (!m.endTime && !m.end_time) return false;
            const endTime = new Date(m.endTime || m.end_time);
            return (now - endTime) > graceMs;
          })
          .map((m) => ({
            eventId: m.eventId || m.event_id || '',
            summary: m.summary || '',
            startTime: m.startTime || m.start_time || '',
            endTime: m.endTime || m.end_time || '',
            attendees: m.attendees || [],
            state: m.state || 'registered',
          }));

        return { success: true, meetings, error: '' };
      } catch (err) {
        return { success: false, meetings: [], error: err.message };
      }
    },

    /**
     * Update meeting state
     * Internally delegates to Recall + Remember to update memory entry
     */
    'state.manager.v1.StateManagerService/UpdateMeetingState': async (ctx) => {
      await initPromise;
      const { eventId, newState } = ctx.request;

      if (!VALID_MEETING_STATES.includes(newState)) {
        return { success: false, error: `Invalid state "${newState}", valid values: ${VALID_MEETING_STATES.join(', ')}` };
      }

      try {
        const existing = await memoryEngine.recall({ key: `meeting:${eventId}`, type: 'commitment' });

        if (!existing.entries || existing.entries.length === 0) {
          return { success: false, error: `Meeting "${eventId}" not found` };
        }

        const entry = existing.entries[0];
        let meeting;
        try {
          meeting = JSON.parse(entry.value);
        } catch {
          return { success: false, error: `Meeting "${eventId}" data corrupted` };
        }

        meeting.state = newState;
        meeting.updatedAt = new Date().toISOString();

        await memoryEngine.remember({
          type: 'commitment',
          key: `meeting:${eventId}`,
          value: JSON.stringify(meeting),
          ttl_seconds: 30 * 86400,
        });

        return { success: true, error: '' };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },

    // ====== User Config ======

    /**
     * Read user personal config
     * Config file: config/user-config.json (filled by deployer per actual environment)
     */
    'state.manager.v1.StateManagerService/GetUserConfig': async () => {
      try {
        const raw = await readFile(config.userConfigPath, 'utf-8');
        const userConfig = JSON.parse(raw);
        return { success: true, config: userConfig, error: '' };
      } catch (err) {
        if (err.code === 'ENOENT') {
          return {
            success: false,
            config: null,
            error: `User config file not found: ${config.userConfigPath}, please create and fill in personal config`,
          };
        }
        return { success: false, config: null, error: `Failed to read config: ${err.message}` };
      }
    },

    // ====== Agent Memory ======

    /**
     * Write a memory entry
     */
    'state.manager.v1.StateManagerService/Remember': async (ctx) => {
      await initPromise; // Ensure initialization is complete
      const result = await memoryEngine.remember(ctx.request);

      // Log to event log (non-blocking)
      eventLog.logEvent({
        event_type: 'memory.remember',
        actor: 'agent',
        description: `Remember: type=${ctx.request.type}, key=${ctx.request.key}, unchanged=${result.unchanged}`,
        level: 'info',
      }).catch(() => {});

      return {
        success: result.success,
        unchanged: result.unchanged || false,
        evictedCount: result.evictedCount || 0,
        error: result.error || '',
      };
    },

    /**
     * Read memory (exact match or prefix match)
     */
    'state.manager.v1.StateManagerService/Recall': async (ctx) => {
      await initPromise;
      const result = await memoryEngine.recall(ctx.request);
      return {
        success: result.success,
        entries: result.entries || [],
        error: result.error || '',
      };
    },

    /**
     * Delete memory
     */
    'state.manager.v1.StateManagerService/Forget': async (ctx) => {
      await initPromise;
      const result = await memoryEngine.forget(ctx.request);

      // Log to event log
      eventLog.logEvent({
        event_type: 'memory.forget',
        actor: 'agent',
        description: `Forget: key=${ctx.request.key || ctx.request.prefix}, deleted=${result.deletedCount}`,
        level: 'info',
      });

      return {
        success: result.success,
        deletedCount: result.deletedCount || 0,
        error: result.error || '',
      };
    },

    /**
     * Get memory engine runtime statistics
     */
    'state.manager.v1.StateManagerService/GetMemoryStats': async () => {
      await initPromise;
      const stats = memoryEngine.getStats();
      return {
        success: true,
        totalEntries: stats.totalEntries || 0,
        typeStats: stats.types || {},
        rememberCalls: stats.rememberCalls || 0,
        recallCalls: stats.recallCalls || 0,
        forgetCalls: stats.forgetCalls || 0,
        totalEvictions: stats.totalEvictions || 0,
        totalDedups: stats.totalDedups || 0,
        tenant: stats.tenant || '',
        userId: stats.userId || '',
        error: '',
      };
    },

    // ====== Distillation Engine ======

    /**
     * Manually trigger a full distillation
     */
    'state.manager.v1.StateManagerService/Distill': async () => {
      await initPromise;
      const result = await distillationEngine.distill();

      eventLog.logEvent({
        event_type: 'distillation.run',
        actor: 'system',
        description: `Distill: actionLog=${JSON.stringify(result.summary?.actionLog)}, session=${JSON.stringify(result.summary?.sessionSummary)}`,
        level: result.success ? 'info' : 'error',
      });

      const s = result.summary || {};
      return {
        success: result.success,
        actionLog: s.actionLog ? { compressed: s.actionLog.compressed || 0, created: s.actionLog.created || 0, deleted: s.actionLog.deleted || 0, reason: s.actionLog.reason || '' } : null,
        sessionSummary: s.sessionSummary ? { compressed: s.sessionSummary.compressed || 0, created: s.sessionSummary.created || 0, deleted: s.sessionSummary.deleted || 0, reason: s.sessionSummary.reason || '' } : null,
        correctionsUpgraded: s.userCorrection?.upgraded || 0,
        correctionsDemoted: s.userCorrection?.demoted || 0,
        error: result.error || '',
      };
    },

    /**
     * Get distillation statistics
     */
    'state.manager.v1.StateManagerService/GetDistillStats': async () => {
      await initPromise;
      const stats = distillationEngine.getStats();
      return {
        success: true,
        totalRuns: stats.totalRuns || 0,
        lastRunAt: stats.lastRunAt || '',
        actionLogCompressed: stats.actionLogCompressed || 0,
        sessionSummaryCompressed: stats.sessionSummaryCompressed || 0,
        correctionsUpgraded: stats.correctionsUpgraded || 0,
        error: '',
      };
    },

    // ====== Task State Machine ======

    /**
     * Create a task
     */
    'state.manager.v1.StateManagerService/CreateTask': async (ctx) => {
      await initPromise;
      const r = ctx.request;
      const result = await taskMachine.createTask({
        task_id: r.taskId || r.task_id,
        name: r.name,
        description: r.description,
        assignee: r.assignee,
        due_date: r.dueDate || r.due_date,
        steps: r.steps,
        priority: r.priority,
      });

      eventLog.logEvent({
        event_type: 'task.created',
        actor: ctx.request.assignee || 'agent',
        description: `CreateTask: ${ctx.request.name} (${result.task_id})`,
        level: 'info',
      });

      return { success: result.success, taskId: result.task_id || '', error: result.error || '' };
    },

    /**
     * Update task state
     */
    'state.manager.v1.StateManagerService/UpdateTask': async (ctx) => {
      await initPromise;
      const r = ctx.request;
      const result = await taskMachine.updateTask({
        task_id: r.taskId || r.task_id,
        new_state: r.newState || r.new_state,
        reason: r.reason,
      });

      eventLog.logEvent({
        event_type: 'task.state_changed',
        actor: 'agent',
        description: `UpdateTask: ${ctx.request.taskId || ctx.request.task_id} ${result.old_state} → ${result.new_state}`,
        level: result.new_state === 'failed' ? 'warning' : 'info',
      });

      return {
        success: result.success,
        oldState: result.old_state || '',
        newState: result.new_state || '',
        error: result.error || '',
      };
    },

    /**
     * Add/update a step
     */
    'state.manager.v1.StateManagerService/UpdateStep': async (ctx) => {
      await initPromise;
      const r = ctx.request;
      const result = await taskMachine.updateStep({
        task_id: r.taskId || r.task_id,
        step_id: r.stepId || r.step_id,
        name: r.name,
        state: r.state,
        notes: r.notes,
      });
      return { success: result.success, stepId: result.step_id || '', error: result.error || '' };
    },

    /**
     * Get a single task
     */
    'state.manager.v1.StateManagerService/GetTask': async (ctx) => {
      await initPromise;
      const taskId = ctx.request.taskId || ctx.request.task_id;
      const result = taskMachine.getTask(taskId);
      return {
        success: result.success,
        task: result.task || null,
        error: result.error || '',
      };
    },

    /**
     * List tasks (with filtering)
     */
    'state.manager.v1.StateManagerService/ListTasks': async (ctx) => {
      await initPromise;
      const r = ctx.request;
      const result = taskMachine.listTasks({
        state: r.state,
        assignee: r.assignee,
        priority: r.priority,
        due_before: r.dueBefore || r.due_before,
        due_after: r.dueAfter || r.due_after,
        limit: r.limit,
      });
      return {
        success: result.success,
        tasks: result.tasks || [],
        total: result.total || 0,
        error: result.error || '',
      };
    },

    /**
     * Get task statistics
     */
    'state.manager.v1.StateManagerService/GetTaskStats': async () => {
      await initPromise;
      const stats = taskMachine.getStats();
      return {
        success: true,
        totalTasks: stats.totalTasks || 0,
        stateCounts: stats.stateCounts || {},
        totalCreated: stats.totalCreated || 0,
        totalCompleted: stats.totalCompleted || 0,
        totalFailed: stats.totalFailed || 0,
        totalTimedOut: stats.totalTimedOut || 0,
        error: '',
      };
    },

    // ====== Event Log ======

    /**
     * Log an event
     */
    'state.manager.v1.StateManagerService/LogEvent': async (ctx) => {
      await initPromise;
      let data = ctx.request.data || '{}';
      try { JSON.parse(data); } catch { data = JSON.stringify({ raw: data }); }
      const result = await eventLog.logEvent({
        event_type: ctx.request.eventType || ctx.request.event_type || 'unknown',
        actor: ctx.request.actor || 'unknown',
        description: ctx.request.description || '',
        data: JSON.parse(data),
        level: ctx.request.level || 'info',
      });
      return { success: result.success, eventId: result.event_id || '', error: result.error || '' };
    },

    /**
     * Query events
     */
    'state.manager.v1.StateManagerService/QueryEvents': async (ctx) => {
      await initPromise;
      const r = ctx.request;
      const result = await eventLog.queryEvents({
        event_type: r.eventType || r.event_type,
        actor: r.actor,
        level: r.level,
        since: r.since,
        until: r.until,
        search: r.search,
        limit: r.limit,
      });
      return {
        success: result.success,
        events: (result.events || []).map(e => ({
          eventId: e.event_id,
          eventType: e.event_type,
          actor: e.actor,
          description: e.description,
          data: JSON.stringify(e.data),
          level: e.level,
          timestamp: e.timestamp,
        })),
        total: result.total || 0,
        error: result.error || '',
      };
    },

    /**
     * Get event log statistics
     */
    'state.manager.v1.StateManagerService/GetEventStats': async () => {
      await initPromise;
      const stats = eventLog.getStats();
      return {
        success: true,
        totalEvents: stats.totalEvents || 0,
        totalLogged: stats.totalLogged || 0,
        totalRotated: stats.totalRotated || 0,
        oldestEvent: stats.oldestEvent || '',
        newestEvent: stats.newestEvent || '',
        error: '',
      };
    },

    // ====== General KV Storage ======

    /**
     * Read state
     */
    'state.manager.v1.StateManagerService/GetState': async (ctx) => {
      const { key } = ctx.request;
      const filePath = join(config.dataDir, 'kv_state.json');

      try {
        const data = await loadJSON(filePath, {});
        return { success: true, value: JSON.stringify(data[key] ?? null), error: '' };
      } catch (err) {
        return { success: false, value: '', error: err.message };
      }
    },

    /**
     * Write state
     */
    'state.manager.v1.StateManagerService/SetState': async (ctx) => {
      const { key, value } = ctx.request;
      const filePath = join(config.dataDir, 'kv_state.json');

      try {
        const data = await loadJSON(filePath, {});
        try {
          data[key] = JSON.parse(value);
        } catch {
          data[key] = value;
        }
        await saveJSON(filePath, data);

        return { success: true, error: '' };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  },
});

runServiceMain(service);

// ====== Graceful Shutdown ======
async function gracefulShutdown(signal) {
  console.log(`[StateService] received ${signal}, shutting down gracefully...`);

  // 1. Stop TTL scan
  ttlManager.stop();

  // 2. Stop task timeout detection
  taskMachine.stop();

  // 3. Final persistence: wait for all in-flight writes
  await storageAdapter.waitForPendingWrites();
  await taskMachine.shutdown();
  await eventLog.shutdown();

  console.log('[StateService] shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
