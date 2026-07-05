#!/usr/bin/env node
/**
 * Agent State Manager — Generic Memory & Distillation Service
 *
 * A generic state management service for AI agents, providing:
 * 1. Memory Engine — Remember/Recall/Forget with typed storage, TTL, and dedup (4 RPCs)
 * 2. Distillation Engine — Automatic memory compression (2 RPCs)
 * 3. Task State Machine — Structured task lifecycle tracking (6 RPCs)
 * 4. Event Log — Append-only event recording (3 RPCs)
 * 5. KV Store — Simple key-value persistence (2 RPCs)
 *
 * Business-specific logic (project matching, weekly reports, meeting tracking,
 * CRM integration, etc.) should be implemented at the agent/skill layer using
 * the generic primitives provided here (Remember/Recall/Forget + Task + EventLog).
 */

import { defineService, runServiceMain } from '@chaitin-ai/octobus-sdk';
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
  tenant: process.env.TENANT || process.env.COMPANY_NAME || 'default',
  userId: process.env.USER_ID || 'default',
};

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
  // 1. Set tenant/userId from environment
  memoryEngine.setIdentity(config.tenant, config.userId);

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

    // ====== Agent Memory ======

    /**
     * Write a memory entry (upsert with dedup and TTL)
     */
    'state.manager.v1.StateManagerService/Remember': async (ctx) => {
      await initPromise;
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
     * Delete memory (exact or batch prefix delete)
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
     * Trigger a distillation pass (compress old/low-priority memories)
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
     * Create a task with optional steps
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
     * Update task state (enforces valid transitions)
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
     * Add or update a step within a task
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
     * Get a single task by ID
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
     * List tasks with filtering
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
     * Append an event record
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
     * Query events with time-range and type filters
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

    // ====== General KV Store ======

    /**
     * Read a key-value pair
     */
    'state.manager.v1.StateManagerService/GetState': async (ctx) => {
      await initPromise;
      const { key } = ctx.request;
      try {
        const value = await memoryEngine.recall({ key });
        if (value.entries && value.entries.length > 0) {
          return { success: true, value: value.entries[0].value || '', error: '' };
        }
        return { success: true, value: '', error: '' };
      } catch (err) {
        return { success: false, value: '', error: err.message };
      }
    },

    /**
     * Write a key-value pair (upsert)
     */
    'state.manager.v1.StateManagerService/SetState': async (ctx) => {
      await initPromise;
      const { key, value } = ctx.request;
      try {
        const result = await memoryEngine.remember({
          key,
          value,
          type: 'kv_store',
          ttl_seconds: 0, // never expire
        });
        return { success: result.success, error: result.error || '' };
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
