# Agent Memory & Distillation Engine — v3 Design

> v3 = 通用化。从"6 个智能体的状态层"升级为"社区可用的 AI 记忆基础设施"。

---

## 一、设计目标

| 目标 | 说明 |
|------|------|
| **通用性** | 不绑定任何业务场景（CRM、钉钉、看板等），任何 AI agent 都能直接用 |
| **记忆即服务** | 记忆不是 KV 存储，是带类型/蒸馏/去重的认知基础设施 |
| **蒸馏是核心差异** | 自动压缩防止记忆膨胀，这是区别于 Redis/SQLite 的本质特征 |
| **API 稳定** | 17 个通用 RPC，加能力不重构，换存储引擎不动 API |

---

## 二、架构

```
┌──────────────────────────────────────────────────────────┐
│                   gRPC / Connect API                      │
│   17 个通用 RPC：记忆(4) + 蒸馏(2) + 任务(6) + 事件(3)    │
│                + KV(2)                                    │
├──────────────────────────────────────────────────────────┤
│  Memory Engine    │ Distillation Engine  │  Task Machine  │
│  Remember/Recall  │  周期压缩             │  状态机          │
│  Forget + 去重    │  模式提取             │  步骤追踪        │
│  TTL 过期         │  摘要合并             │  超时检测        │
├──────────────────────────────────────────────────────────┤
│  Type Registry    │  TTL Manager          │  Event Log     │
│  5 类默认 + 可扩展 │  后台扫描清理          │  追加写入        │
├──────────────────────────────────────────────────────────┤
│              Storage Adapter（可插拔）                      │
│         JSON File ← SQLite ← etcd ← Redis                │
└──────────────────────────────────────────────────────────┘
```

**核心原则**：API 稳定，实现可换。换存储引擎、加蒸馏策略，API 层不动。

---

## 三、17 个通用 RPC

### 3.1 记忆引擎（4 个）

| RPC | 功能 | 设计要点 |
|-----|------|---------|
| Remember | 写入记忆 | upsert + 去重窗口 + TTL + 类型化默认值 |
| Recall | 读取记忆 | 精确匹配 / 前缀匹配 / 类型过滤 |
| Forget | 删除记忆 | 精确删除 / 前缀批量删除 |
| GetMemoryStats | 记忆统计 | 条数、类型分布、调用量、淘汰数 |

### 3.2 蒸馏引擎（2 个）

| RPC | 功能 | 设计要点 |
|-----|------|---------|
| Distill | 触发蒸馏 | action_log → 模式摘要；session_summary → 月度合并；correction 升降级 |
| GetDistillStats | 蒸馏统计 | 运行次数、压缩量、上次运行时间 |

### 3.3 任务状态机（6 个）

| RPC | 功能 | 设计要点 |
|-----|------|---------|
| CreateTask | 创建任务 | 可选步骤列表、优先级、截止日期 |
| UpdateTask | 更新状态 | 合法转换表校验：pending→running→done/failed/cancelled/timed_out |
| UpdateStep | 更新步骤 | 步骤级别状态追踪 |
| GetTask | 查询单个 | 含步骤详情 + 状态历史 |
| ListTasks | 列表查询 | 按状态/负责人/优先级/截止日过滤 |
| GetTaskStats | 任务统计 | 各状态计数、创建/完成/失败/超时累计 |

### 3.4 事件日志（3 个）

| RPC | 功能 | 设计要点 |
|-----|------|---------|
| LogEvent | 记录事件 | 追加写入，不删除不修改 |
| QueryEvents | 查询事件 | 按类型/角色/级别/时间范围过滤 |
| GetEventStats | 事件统计 | 总数、轮转数、最早/最新事件 |

### 3.5 KV 存储（2 个）

| RPC | 功能 | 设计要点 |
|-----|------|---------|
| GetState | 读取 KV | 底层委托记忆引擎 |
| SetState | 写入 KV | 底层委托记忆引擎，永不过期 |

---

## 四、五类记忆结构

| 类型 | 默认 TTL | 去重窗口 | 最大条数 | 淘汰策略 | 典型场景 |
|------|---------|---------|---------|---------|---------|
| entity_cache | 7 天 | 无 | 200 | LRU | 缓存昂贵查询结果（API 返回值、外部 ID） |
| action_log | 7 天 | 24 小时 | 1000 | 最旧优先 | 操作审计 + 幂等去重（防止重复执行写操作） |
| user_correction | 永久 | 无 | 100 | 压缩 | 用户纠正记录（最高价值记忆，永久保留） |
| commitment | 30 天 | 无 | 100 | LRU | 待办承诺（用户说"下周跟进"） |
| session_summary | 30 天 | 无 | 50 | 最旧优先 | 会话关键决策 + 待办清单 |

**扩展新类型**：在 TypeRegistry 加一行，API 立即生效。蒸馏引擎也读注册表决定压缩策略。

---

## 五、蒸馏引擎——核心差异

蒸馏是状态层从"被动存储"变成"主动认知引擎"的关键：

### 三级蒸馏

| 级别 | 机制 | 触发方式 |
|------|------|---------|
| 被动淘汰 | TTL 过期 + 容量上限 LRU | 自动（后台扫描） |
| 主动压缩 | action_log 周期模式提取（~10:1 压缩比） | Distill() RPC 或定时调用 |
| 周期汇总 | session_summary 月度合并 | Distill() RPC |

### 蒸馏策略

- **action_log → 模式摘要**：按 action/entity 统计频率，生成 Top5 模式，删除原始条目
- **session_summary → 月度合并**：合并 topics/decisions/pending/entities，TTL=90 天
- **user_correction 容量管理**：接近上限时，旧条目降级为 action_log（保留但不占高价值槽位）

---

## 六、业务逻辑归属

**v3 的核心设计决策：OctoBus 只做通用能力，业务逻辑在 agent 层。**

| 层级 | 职责 | 举例 |
|------|------|------|
| **OctoBus 服务** | 通用基础设施 | Remember/Recall/Forget、Distill、Task、EventLog |
| **Agent Prompt** | 业务编排 | "查 CRM → Remember(type=entity_cache)"、"用户纠正 → Remember(type=user_correction)" |
| **Agent Skill** | 复合操作 | 用 Recall + Remember 组合实现项目匹配、周报同步、会议追踪 |

### 迁移示例

| 旧便捷 RPC | 通用 API 组合 |
|-----------|-------------|
| MatchProject(text) | Recall(prefix="project:") → agent LLM 判断匹配 |
| AddPendingItem(summary) | Remember(type=commitment, key="weekly_item:...") |
| RegisterMeeting(eventId) | Remember(type=commitment, key="meeting:{id}") |
| UpdateMeetingState(id, state) | Recall(key="meeting:{id}") + Remember 更新 |
| GetUserConfig() | GetState(key="user_config") 或环境变量 |

---

## 七、多租户设计（ADR-004）

所有记忆 key 遵守 `{tenant}:{type}:{key}` 命名规范：
- 当前 tenant 从环境变量 `TENANT` 读取（默认 `default`）
- userId 从 `USER_ID` 读取（默认 `default`）
- 将来加鉴权：API 层加前缀校验，存储引擎不动

---

## 八、可靠性保证

状态层作为持久化基础设施，对并发写入、崩溃恢复、错误可观测性有明确保证。以下机制覆盖 EventLog、DocMemory 及 StorageAdapter：

### 8.1 并发写入串行化（防 TOCTOU）

所有 read-modify-write 路径经 Promise 链锁串行化，防止两个并发写各自读到旧状态、各自写回导致后写覆盖前写：

| 组件 | 链锁 | 保护范围 |
|------|------|---------|
| EventLog | `_saveChain` | `logEvent`/`_save`/`_rotate` 串行落盘 |
| DocMemory | `_chain` | `get`/`set` 的 load→modify→save 串行 |
| StorageAdapter | 内部链锁 | 所有 JSON 文件读写 |

链锁自身具备**失败恢复**：一次写入失败不会永久阻塞后续调用（链尾 `.catch(() => {})` 恢复链，同时原 promise 向调用方传播错误）。

### 8.2 原子写入 + 临时文件清理

写入采用「先写临时文件再 rename」：
- 临时文件名含 `Date.now()` + 随机后缀，防并发碰撞
- `try/finally` 确保 rename 失败时 `rm(tmpPath, {force:true})` 清理残留，避免长期积累 `.tmp`

进程在写入过程中崩溃时，目标文件要么是旧完整内容、要么是新完整内容，不会出现半写损坏。

### 8.3 错误不静默吞没

文件操作 `catch` 区分 `ENOENT` 与其他错误：
- **ENOENT**（文件不存在）：首次启动的正常情况，静默跳过
- **其他**（EACCES/ENOSPC/JSON 损坏等）：输出 `warn`/`error` 日志，避免数据丢失或查询不完整而无从排查

### 8.4 轮转数据保护

`_rotate()` 先 `await this._save()` 落盘内存事件，再执行文件重命名与清空：
- `_save()` 失败 → `_rotate` 捕获异常、**不清空内存**、记日志，下次 `logEvent` 重试持久化
- 避免磁盘满/权限不足时未落盘事件被轮转清空导致永久丢失

---

## 九、路线图

```
v1 MVP（已完成）       v2 增强（已完成）        v3 通用化（本次）         v4 远期
─────────────────────────────────────────────────────────────────────────────
Remember/Recall        蒸馏引擎 ✅              剥离业务 RPC ✅            租户鉴权
Forget                 任务状态机 ✅             17 通用 RPC ✅            SQLite 迁移
5 类记忆行为           事件日志 ✅              通用配置 ✅               语义搜索(embedding)
GetMemoryStats ✅      28 个 RPC ✅             v3 设计文档 ✅            商业化 API
                       操作审计 ✅              js-yaml 依赖移除 ✅
                       优雅停机 ✅
└─ 解决"有无"         └─ 体现"蒸馏"价值       └─ 社区可用              └─ 生产级闭环
```

---

*本文档随代码演进持续更新。每次架构变更必须同步修改。*
