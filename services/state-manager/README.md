# state-manager — Agent Memory & Distillation Engine

A generic state management service for AI agents, built on [OctoBus](https://github.com/chaitin/OctoBus).

## Why This Exists

AI agents today are stateless — every conversation starts from zero. This service gives agents:

- **Persistent memory** that survives across sessions (Remember/Recall/Forget)
- **Automatic distillation** that compresses old memories to prevent unbounded growth
- **Task tracking** with structured state machines (not just "I'll do it" → forgotten)
- **Event logging** for full audit trails

The key differentiator is **distillation** — not just storing data, but actively compressing, summarizing, and prioritizing it. This transforms the service from passive storage into an active cognitive layer.

## Architecture

```
┌─────────────────────────────────────────────┐
│            gRPC / Connect API (17 RPCs)      │
├──────────┬──────────────┬──────────┬────────┤
│ Memory   │ Distillation │  Task    │ Event  │
│ Engine   │   Engine     │ Machine  │  Log   │
├──────────┴──────────────┴──────────┴────────┤
│  Type Registry  │  TTL Manager  │  Index    │
├─────────────────────────────────────────────┤
│          Storage Adapter (pluggable)         │
│     JSON File → SQLite → etcd → Redis       │
└─────────────────────────────────────────────┘
```

## Five Memory Types

| Type | TTL | Dedup | Use Case |
|------|-----|-------|----------|
| `entity_cache` | 7 days | None | Cache expensive query results |
| `action_log` | 7 days | 24h | Idempotent dedup + audit trail |
| `user_correction` | Forever | None | Highest-value: user fixes to agent behavior |
| `commitment` | 30 days | None | Track future promises ("follow up next week") |
| `session_summary` | 30 days | None | Key decisions + pending items per session |

Add custom types via the Type Registry — no code changes needed.

## Quick Start

### 1. Install as OctoBus service

```bash
octobus service import /path/to/state-manager
```

### 2. Configure environment

```bash
export DATA_DIR=/path/to/data        # Persistent storage directory
export TENANT=my_company             # Tenant ID for key namespacing
export USER_ID=my_agent              # User ID for memory isolation
```

### 3. Use from agent

```bash
# Remember a query result
grpcurl -plaintext \
  -H "x-octobus-capset: default" \
  -H "x-octobus-instance: state-manager" \
  -d '{"type":"entity_cache","key":"customer:acme","value":"{\"id\":\"123\",\"name\":\"Acme Corp\"}"}' \
  $CAP_GRPC_TARGET state.manager.v1.StateManagerService/Remember

# Recall it later
grpcurl -plaintext \
  -d '{"key":"customer:acme"}' \
  $CAP_GRPC_TARGET state.manager.v1.StateManagerService/Recall

# Trigger memory compression
grpcurl -plaintext \
  -d '{}' \
  $CAP_GRPC_TARGET state.manager.v1.StateManagerService/Distill
```

## RPC Reference (17 methods)

### Memory (4)
- `Remember(key, value, type, ttl_seconds, dedup_window_sec, confidence)` — Write memory
- `Recall(key | prefix, type, limit)` — Read memory
- `Forget(key | prefix, type)` — Delete memory
- `GetMemoryStats()` — Memory statistics

### Distillation (2)
- `Distill()` — Trigger compression pass
- `GetDistillStats()` — Compression statistics

### Task (6)
- `CreateTask(name, description, assignee, due_date, steps, priority)` — Create task
- `UpdateTask(task_id, new_state, reason)` — Update state (valid transitions only)
- `UpdateStep(task_id, step_id, name, state, notes)` — Update step
- `GetTask(task_id)` — Get task details
- `ListTasks(state, assignee, priority, due_before, due_after, limit)` — List with filters
- `GetTaskStats()` — Task statistics

### Event Log (3)
- `LogEvent(event_type, actor, description, data, level)` — Append event
- `QueryEvents(event_type, actor, level, since, until, search, limit)` — Query events
- `GetEventStats()` — Event statistics

### KV Store (2)
- `GetState(key)` — Read value
- `SetState(key, value)` — Write value

## Design Decisions

See [docs/v3-design.md](docs/v3-design.md) for the full design document, including:
- Five memory types and their lifecycle
- Three-level distillation strategy
- Business logic separation (service = generic primitives, agent = business logic)
- Multi-tenant key namespacing
- Pluggable storage adapter design

## License

Same as OctoBus.
