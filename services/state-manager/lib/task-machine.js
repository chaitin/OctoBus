/**
 * TaskMachine — Task State Machine
 *
 * Manages the lifecycle of multi-step tasks:
 *   pending → running → done / failed / cancelled / timed_out
 *
 * Core value: lets agents track "which step a long task has reached",
 * instead of relying on LLM memory to chain multi-step flows.
 *
 * Persistence: task_state.json (atomic write)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// Valid state transitions
const VALID_TRANSITIONS = {
  pending:    ['running', 'cancelled'],
  running:    ['done', 'failed', 'cancelled', 'timed_out', 'pending'],
  done:       [],           // terminal state
  failed:     ['pending'],  // can retry
  cancelled:  ['pending'],  // can restore
  timed_out:  ['pending', 'running'],  // can retry or continue
};

const VALID_STATES = Object.keys(VALID_TRANSITIONS);

export class TaskMachine {
  /**
   * @param {string} dataDir - Data directory
   * @param {object} opts
   * @param {number} opts.checkIntervalMs - Timeout check interval (default 60000ms)
   */
  constructor(dataDir, opts = {}) {
    this.filePath = `${dataDir}/task_state.json`;
    this.tasks = new Map();           // taskId → task
    this.checkIntervalMs = opts.checkIntervalMs || 60000;
    this._timer = null;
    this._dirty = false;
    this._saveChain = Promise.resolve();  // 串行化并发 _save 调用

    // Statistics
    this._stats = {
      totalCreated: 0,
      totalCompleted: 0,
      totalFailed: 0,
      totalTimedOut: 0,
    };
  }

  // ─── Lifecycle ───

  async initialize() {
    await this._load();
    this.startTimeoutChecker();
    console.log(`[TaskMachine] initialized: ${this.tasks.size} tasks loaded`);
  }

  startTimeoutChecker() {
    if (this._timer) return;
    this._timer = setInterval(() => this._checkTimeouts(), this.checkIntervalMs);
    if (this._timer.unref) this._timer.unref();
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async shutdown() {
    this.stop();
    if (this._dirty) await this._save();
  }

  // ─── Create Task ───

  /**
   * @param {object} request
   * @param {string} request.task_id - Task ID (optional, auto-generated)
   * @param {string} request.name - Task name
   * @param {string} request.description - Task description
   * @param {string} request.assignee - Assignee
   * @param {string} request.due_date - Due date ISO 8601
   * @param {string[]} request.steps - Initial step list
   * @param {string} request.priority - high / medium / low
   * @param {object} request.metadata - Additional data
   * @returns {object} { success, task_id, error }
   */
  async createTask(request) {
    try {
      const taskId = request.task_id || `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      if (this.tasks.has(taskId)) {
        return { success: false, task_id: taskId, error: `Task "${taskId}" already exists` };
      }

      const now = new Date().toISOString();
      const task = {
        task_id: taskId,
        name: request.name || '',
        description: request.description || '',
        assignee: request.assignee || '',
        state: 'pending',
        priority: request.priority || 'medium',
        due_date: request.due_date || null,
        steps: (request.steps || []).map((s, i) => ({
          step_id: `step_${i}`,
          name: typeof s === 'string' ? s : s.name,
          state: 'pending',
          completed_at: null,
          notes: typeof s === 'string' ? '' : (s.notes || ''),
        })),
        current_step: null,
        metadata: request.metadata || {},
        created_at: now,
        updated_at: now,
        state_history: [{ state: 'pending', at: now, reason: 'created' }],
      };

      this.tasks.set(taskId, task);
      this._stats.totalCreated++;
      this._dirty = true;
      await this._save();

      return { success: true, task_id: taskId, error: '' };
    } catch (err) {
      return { success: false, task_id: '', error: err.message };
    }
  }

  // ─── Update Task State ───

  /**
   * @param {object} request
   * @param {string} request.task_id
   * @param {string} request.new_state
   * @param {string} request.reason - Reason for state change
   * @returns {object} { success, old_state, new_state, error }
   */
  async updateTask(request) {
    try {
      const task = this.tasks.get(request.task_id);
      if (!task) {
        return { success: false, old_state: '', new_state: '', error: `Task "${request.task_id}" not found` };
      }

      const oldState = task.state;
      const newState = request.new_state;

      // Validate state transition
      if (!VALID_STATES.includes(newState)) {
        return { success: false, old_state: oldState, new_state: '', error: `Invalid state "${newState}"` };
      }

      const allowed = VALID_TRANSITIONS[oldState] || [];
      if (!allowed.includes(newState)) {
        return {
          success: false,
          old_state: oldState,
          new_state: '',
          error: `Transition from "${oldState}" to "${newState}" not allowed, allowed: ${allowed.join(', ')}`,
        };
      }

      const now = new Date().toISOString();
      task.state = newState;
      task.updated_at = now;
      task.state_history.push({ state: newState, at: now, reason: request.reason || '' });

      // Terminal state statistics
      if (newState === 'done') this._stats.totalCompleted++;
      if (newState === 'failed') this._stats.totalFailed++;
      if (newState === 'timed_out') this._stats.totalTimedOut++;

      this._dirty = true;
      await this._save();

      return { success: true, old_state: oldState, new_state: newState, error: '' };
    } catch (err) {
      return { success: false, old_state: '', new_state: '', error: err.message };
    }
  }

  // ─── Add/Update Step ───

  /**
   * @param {object} request
   * @param {string} request.task_id
   * @param {string} request.step_id - Step ID (optional when adding new)
   * @param {string} request.name - Step name
   * @param {string} request.state - pending / running / done / skipped
   * @param {string} request.notes - Notes
   * @returns {object} { success, step_id, error }
   */
  async updateStep(request) {
    try {
      const task = this.tasks.get(request.task_id);
      if (!task) {
        return { success: false, step_id: '', error: `Task "${request.task_id}" not found` };
      }

      let step = null;
      if (request.step_id) {
        step = task.steps.find(s => s.step_id === request.step_id);
      }

      const now = new Date().toISOString();

      if (step) {
        // Update existing step
        if (request.state) step.state = request.state;
        if (request.notes) step.notes = request.notes;
        if (request.name) step.name = request.name;
        if (request.state === 'done') step.completed_at = now;

        // Auto-advance current_step
        if (request.state === 'done') {
          const nextPending = task.steps.find(s => s.state === 'pending');
          task.current_step = nextPending ? nextPending.step_id : null;
        }
      } else {
        // Add new step
        const stepId = request.step_id || `step_${task.steps.length}`;
        step = {
          step_id: stepId,
          name: request.name || '',
          state: request.state || 'pending',
          completed_at: request.state === 'done' ? now : null,
          notes: request.notes || '',
        };
        task.steps.push(step);
      }

      task.updated_at = now;
      this._dirty = true;
      await this._save();

      return { success: true, step_id: step.step_id, error: '' };
    } catch (err) {
      return { success: false, step_id: '', error: err.message };
    }
  }

  // ─── Query Tasks ───

  /**
   * @param {string} taskId
   * @returns {object} { success, task, error }
   */
  getTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, task: null, error: `Task "${taskId}" not found` };
    }
    return { success: true, task: this._formatTask(task), error: '' };
  }

  /**
   * @param {object} filter - { state, assignee, priority, due_before, due_after, limit }
   * @returns {object} { success, tasks, total, error }
   */
  listTasks(filter = {}) {
    let results = [...this.tasks.values()];

    if (filter.state) {
      const states = filter.state.split(',');
      results = results.filter(t => states.includes(t.state));
    }
    if (filter.assignee) {
      results = results.filter(t => t.assignee === filter.assignee);
    }
    if (filter.priority) {
      results = results.filter(t => t.priority === filter.priority);
    }
    if (filter.due_before) {
      const before = new Date(filter.due_before);
      results = results.filter(t => t.due_date && new Date(t.due_date) <= before);
    }
    if (filter.due_after) {
      const after = new Date(filter.due_after);
      results = results.filter(t => t.due_date && new Date(t.due_date) >= after);
    }

    // Sort by priority + creation time
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    results.sort((a, b) => {
      const pa = priorityOrder[a.priority] ?? 1;
      const pb = priorityOrder[b.priority] ?? 1;
      if (pa !== pb) return pa - pb;
      return new Date(b.created_at) - new Date(a.created_at);
    });

    const total = results.length;
    const limit = filter.limit || 50;
    results = results.slice(0, limit);

    return {
      success: true,
      tasks: results.map(t => this._formatTask(t)),
      total,
      error: '',
    };
  }

  /**
   * Get task state machine statistics
   */
  getStats() {
    const stateCounts = {};
    for (const state of VALID_STATES) {
      stateCounts[state] = 0;
    }
    for (const task of this.tasks.values()) {
      stateCounts[task.state] = (stateCounts[task.state] || 0) + 1;
    }

    return {
      totalTasks: this.tasks.size,
      stateCounts,
      ...this._stats,
    };
  }

  // ─── Timeout Detection ───

  async _checkTimeouts() {
    const now = new Date();
    let changed = false;

    for (const [taskId, task] of this.tasks) {
      // Only check pending and running tasks
      if (task.state !== 'pending' && task.state !== 'running') continue;
      if (!task.due_date) continue;

      const due = new Date(task.due_date);
      if (now > due) {
        // Timed out
        task.state = 'timed_out';
        task.updated_at = now.toISOString();
        task.state_history.push({
          state: 'timed_out',
          at: now.toISOString(),
          reason: `Past due date ${task.due_date}`,
        });
        this._stats.totalTimedOut++;
        changed = true;

        console.log(`[TaskMachine] task "${taskId}" timed out (due: ${task.due_date})`);
      }
    }

    if (changed) {
      this._dirty = true;
      try {
        await this._save();
      } catch (err) {
        console.error('[TaskMachine] timeout check save failed (tasks held in memory):', err.message);
      }
    }
  }

  // ─── Internal Methods ───

  _formatTask(task) {
    const totalSteps = task.steps.length;
    const doneSteps = task.steps.filter(s => s.state === 'done').length;
    return {
      task_id: task.task_id,
      name: task.name,
      description: task.description,
      assignee: task.assignee,
      state: task.state,
      priority: task.priority,
      due_date: task.due_date || '',
      current_step: task.current_step || '',
      steps: task.steps,
      progress: totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0,
      metadata: task.metadata,
      created_at: task.created_at,
      updated_at: task.updated_at,
      state_history: task.state_history,
    };
  }

  async _load() {
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      const data = JSON.parse(raw);
      if (data.tasks && typeof data.tasks === 'object') {
        for (const [id, task] of Object.entries(data.tasks)) {
          this.tasks.set(id, task);
        }
      }
    } catch {
      // File does not exist, start from empty
    }
  }

  async _save() {
    // 串行化并发写入，防止更新丢失。
    // The returned promise propagates errors so callers (updateTask, createTask)
    // can detect persistence failures. The queue itself recovers after a
    // failure so subsequent writes are not permanently blocked.
    const writePromise = this._saveChain.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const data = {
        version: 1,
        updatedAt: new Date().toISOString(),
        taskCount: this.tasks.size,
        tasks: Object.fromEntries(this.tasks),
      };
      const tmpPath = `${this.filePath}.${Date.now()}.tmp`;
      await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
      const { rename } = await import('node:fs/promises');
      await rename(tmpPath, this.filePath);
      this._dirty = false;
    });
    this._saveChain = writePromise.catch((err) => {
      console.error('[TaskMachine] save error (tasks held in memory, queue continues):', err.message);
    });
    return writePromise;
  }
}

export default TaskMachine;
