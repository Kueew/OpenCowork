# 多会话 Agent 后台静默执行改造计划

## 1. 目标

在 OpenCoWork 中实现 **多会话 / 多 Team 并发运行时，只有当前选中的会话驱动实时 UI**：

- 非当前会话继续执行，但不持续驱动当前 renderer 的可见 UI
- 仍然保留 **token 级完整过程**（用户要求）
- 用户切回该会话时，立即同步到最新状态，并继续实时展示
- 后台会话若触发需要前台介入的能力，进入 **blocked**，不抢焦点，只通过：
  - 会话列表徽标/计数
  - 全局待处理中心
  - toast（仅 blocked / error / completed）
  来提醒用户
- 范围覆盖：
  - 手动聊天会话 Agent
  - Task 子 Agent / Team 协作
- 暂不纳入：
  - cron
  - 插件 auto-reply

## 2. 已确认需求（来自澄清）

1. 非当前会话应“静默执行”，但仍保留完整过程
2. 切回后台运行中的会话时：**同步到最新快照并继续实时流**
3. 后台触发前台交互能力时：**弹全局提示但不抢焦点**
4. blocked 入口：**会话列表徽标 + 全局待处理中心**
5. `OpenPreview` 在后台时：**不自动打开面板，只记录为可预览项并提示**
6. 全局提示粒度：**仅 blocked / error / completed**
7. 并发目标：**10+ 个会话/团队任务**
8. 会话列表展示：**状态图标 + 计数**
9. 点击全局待处理项：**切到会话并打开对应上下文**
10. 后台过程精度：**token 级完整累计**

## 3. 当前实现事实（代码证据）

### 3.1 会话并发基础已经存在

- `chat-store.ts` 已按 `sessionId` 维护：
  - `sessions[].messages`
  - `streamingMessages`
  - `activeSessionId`
- `setActiveSession()` 切会话时会：
  - 切换当前 session
  - 恢复该会话的 tool-call cache
  - 加载该会话最近消息

### 3.2 但后台会话仍持续驱动 renderer store

`use-chat-actions.ts` 中 agent loop 事件直接调用：

- `chatStore.appendTextDelta`
- `chatStore.appendThinkingDelta`
- `chatStore.appendToolUse`
- `chatStore.updateToolUseInput`
- `agentStore.addToolCall / updateToolCall / handleSubAgentEvent`

这意味着即使某会话不是当前会话，它仍然在高频修改响应式 store。

### 3.3 当前 dormant 释放逻辑不会释放流式中的后台会话

`chat-store.ts` 的 resident session 计算会保留：

- 当前会话
- mini window 会话
- `streamingMessages` 中的会话

所以并发运行中的后台会话会长期驻留内存，并继续累积响应式变更。

### 3.4 当前 UI 有跨会话污染

- `TitleBar.tsx` / `TopBar.tsx` 使用全局 `runningSubAgentNamesSig`
- 这会让其他会话的 SubAgent 运行态影响当前顶部状态
- 后台会话不是真正“无 UI 交互”

### 3.5 当前 Tool / SubAgent 状态不是严格 per-session

`use-chat-actions.ts` 在新 agent run 开始时调用 `agentStore.clearToolCalls()`，会清空：

- `pendingToolCalls`
- `executedToolCalls`
- `activeSubAgents`
- `sessionToolCallsCache`
- `sessionSubAgentSummaries`
- `sessionBackgroundProcessSummaries`

这说明当前 live execution store 仍偏“全局当前会话模型”，不适合高并发多会话。

### 3.6 背景 Team worker 已经是隐藏窗口

`main/ipc/team-worker-handlers.ts`：

- 后台 teammate 用 `BrowserWindow({ show: false })`
- `App.tsx` 中 `ocWorker=team` 时只渲染极简 loading 页面

因此 **Team worker 本身不需要再做“隐藏窗口”层面的改造**；重点在主会话 renderer 如何接纳/隔离它们的运行事件。

### 3.7 blocked 交互目前没有跨会话中枢

当前状态：

- `AskUserQuestion`：会话内卡片模型
- Approval：挂在当前 `pendingToolCalls`
- `OpenPreview`：直接打开全局 preview panel

要满足“后台不抢焦点，只提示”，必须新增 **跨会话 blocked/inbox 机制**。

## 4. 总体设计

核心思路：把“执行态”拆成两层。

### 4.1 第一层：后台运行缓冲层（非响应式 / 低响应式）

新增一个 **session runtime router / background execution buffer**，用于承接所有 session 的 agent 事件：

- 当前可见会话：走前台 live sink，按现有方式驱动 UI
- 非当前会话：走后台 silent sink，不直接改动当前 UI 所依赖的响应式 live store

后台 silent sink 需要保留：

- assistant token 流累计
- tool_use / tool_result 过程
- sub-agent transcript / streaming text / tool calls
- background process output
- blocked item
- unread/background delta 计数
- 最后更新时间

但这些状态应尽量放在：

- 非 React 高频订阅路径
- 非当前会话不触发全局组件频繁重渲染

### 4.2 第二层：前台投影层（当前会话专属）

只有当前会话（及必要时 mini-window 会话）映射到现有 UI store 投影：

- `chat-store` 当前消息视图
- `agent-store` 当前 tool calls / approvals / sub-agent live panels
- 顶部状态、右侧面板、详细面板、预览面板

用户切到后台会话时：

1. 将该 session 的后台缓冲快照投影到前台 store
2. 切换该 session 后续事件流到 foreground sink
3. 同步打开需要的上下文（若是从 inbox/blocked item 进入）

## 5. 数据与状态模型改造

### 5.1 新增“会话执行可见性”概念

引入统一判定：

- foreground session：`activeSessionId`
- auxiliary visible session：mini window（若需要保留）
- background session：其他运行中的 session

建议新增统一 helper，例如：

- `isSessionForeground(sessionId)`
- `getVisibleSessionIds()`
- `routeExecutionEvent(sessionId, event)`

### 5.2 新增后台执行索引/缓冲 store（或 manager）

建议新增一个独立模块（优先 renderer 内单例 manager + 极薄 store 投影），例如：

- `src/renderer/src/lib/agent/session-runtime-router.ts`
- `src/renderer/src/stores/background-session-store.ts`

至少维护：

- `backgroundSessions[sessionId]`
  - latest assistant text snapshot
  - latest tool call states
  - latest sub-agent summaries / transcripts
  - latest background process summaries / output ring buffer
  - unread event count / unread token count（可简化为 unread updates）
  - blocked items
  - lastEventAt
  - error / completed flags
- `globalPendingInbox`
  - itemId
  - sessionId
  - type: `ask_user` | `approval` | `preview_ready` | `desktop_control` | `foreground_bash` | `error`
  - target payload（跳转上下文所需）
  - createdAt / resolvedAt / dismissedAt

### 5.3 将 `agent-store` 改成“当前会话投影 + 跨会话摘要”

保留 `agent-store` 作为 UI 直接消费层，但拆分责任：

1. **当前会话 live execution state**
   - `pendingToolCalls`
   - `executedToolCalls`
   - `activeSubAgents`
   - `completedSubAgents`
2. **跨会话摘要态**
   - `runningSessions`
   - `sessionStatusCounts`
   - `sessionBlockedCounts`
   - `sessionUnreadCounts`
   - `sessionBackgroundProcessSummaries`
   - `sessionSubAgentSummaries`（摘要而非全量 live）
3. 移除/弱化全局共享 live 字段对所有会话的影响
   - 尤其是 `runningSubAgentNamesSig`
   - 改为 `getRunningSubAgentNamesSig(sessionId)` 或 active-session selector

### 5.4 将 `clearToolCalls()` 拆成 session-scoped API

新增：

- `resetLiveSessionExecution(sessionId)`
- `hydrateLiveSessionExecution(sessionId, snapshot)`
- `detachLiveSessionExecution(sessionId)`

不要再在任意 session 开始运行时清空其他 session 的 live / summary 状态。

## 6. 事件路由改造（核心）

### 6.1 ��构 `use-chat-actions.ts` 中的 agent loop 事件处理

当前是“事件 -> 直接写 chat-store / agent-store”。

目标改为：

`AgentEvent -> Session Runtime Router -> Foreground Sink / Background Sink`

#### Foreground sink

当前可见 session 继续保留现有行为：

- 文本流、thinking、tool args、sub-agent 详情实时展示
- approvals / AskUserQuestion 卡片保留当前交互方式
- `OpenPreview` 正常打开面板

#### Background sink

后台 session 改为：

- 不直接改当前 UI live store
- 将 token / tool / sub-agent / process 输出写入后台缓冲
- 只做低频摘要更新：
  - session running / blocked / error / completed
  - unread count
  - blocked count
  - last updated
- 当事件涉及强交互能力时：
  - 生成 pending inbox item
  - 对 session 打 blocked 标记
  - 发 toast（不切焦点）
  - 暂停该 session 的相关执行点，等待用户切入并处理

### 6.2 后台会话切前台时的 hydration

在 `setActiveSession()` 或统一 runtime router 中加入：

1. flush 该 session 的后台缓冲
2. 将最新 assistant message / tool blocks / tool states / sub-agent summaries 投影到当前 live store
3. 恢复审批 / AskUserQuestion / preview-ready 对应上下文
4. 后续增量改走 foreground sink
5. 清理该 session 的 unread 计数

### 6.3 token 级要求的处理方式

用户要求后台也保留 token 级完整过程，因此不能只保留 message_end。

但为了满足 10+ 并发，计划采用：

- 后台仍接收 token 级事件
- **不走 React 响应式路径**
- 在后台缓冲中以 append-only / ring-buffer 形式累计
- 前台切入时直接渲染“最新完整状态”，不回放动画

这能同时满足：

- token 级过程不丢
- 当前 UI 不被后台会话高频驱动

## 7. blocked / inbox 机制设计

### 7.1 新的 blocked item 类型

统一抽象：

- `ask_user`
- `approval`
- `preview_ready`
- `desktop_control`
- `foreground_bash`
- `error`

### 7.2 背景能力的处理规则

#### `AskUserQuestion`

- 后台不直接要求当前视图渲染问答卡
- 生成 blocked item
- session 列表计数 + 全局 inbox
- 用户点击后：切 session，并定位到对应 AskUserQuestion 卡片

#### approval（含 MCP / Task background spawn / 其他需审批工具）

- 后台不占用当前 `pendingToolCalls` UI
- 生成跨会话 approval item
- 点击后切 session 并打开审批上下文

#### `OpenPreview`

- 后台不直接打开 preview panel
- 生成 `preview_ready` item
- toast: “某会话有新预览可查看”
- 点击后：切 session + 打开对应 preview

#### desktop / foreground bash

- 后台触发时直接 blocked
- 不允许默默接管桌面或抢占当前前台终端 UI
- 点击 item 后切入会话，再执行/继续

## 8. UI 改造点

### 8.1 会话列表 `SessionListPanel.tsx`

新增/调整：

- 每个 session 显示：
  - running
  - blocked
  - error
  - completed
- 计数：
  - blocked count
  - unread background updates（或 unread items）
- 当前已有 spinner / completed icon / pending queue count，可复用一部分结构

### 8.2 全局待处理中心

建议在 `TopBar.tsx` / `TitleBar.tsx` 增加一个 inbox 入口：

- 显示总 blocked/pending 数
- 点击弹出列表
- 每项包含：
  - session title
  - item type
  - 简短原因
  - 时间
- 点击项后：
  - `setActiveSession(sessionId)`
  - 打开对应上下文

### 8.3 顶部状态去全局污染

`TopBar.tsx` / `TitleBar.tsx` 改为只看：

- 当前 active session 的 live execution state
- 或全局 inbox 总数（作为独立入口）

不能再让其他 session 的 `runningSubAgentNamesSig` 直接干扰当前顶部状态。

### 8.4 右侧面板 / 详情面板深链打开

需要支持“从 inbox item 直���打开对应上下文”：

- AskUserQuestion 卡片
- approval item
- preview item
- sub-agent detail
- orchestration member / run

可能需要扩展 `ui-store.ts`：

- `openPendingInbox()`
- `openSessionContextTarget(target)`
- `selectedPendingItemId`

## 9. Team / SubAgent 范围内的特殊处理

### 9.1 Team worker 不再额外改窗口行为

隐藏 worker 窗口当前已满足“后台不打扰”。

### 9.2 Lead session 中的 Team / SubAgent 事件统一走同一套 session 路由

- 若 lead session 是当前会话：实时展示
- 若 lead session 在后台：
  - transcript / sub-agent streaming 保留到后台缓冲
  - 仅更新会话级状态与 blocked / unread 计数

### 9.3 Orchestration / SubAgent 面板需按当前会话投影

相关面板目前读：

- `activeSubAgents`
- `completedSubAgents`
- `subAgentHistory`

需要改成：

- 当前会话直接读 live projection
- 非当前会话不影响当前面板
- 切会话时由 runtime router / hydrate 机制恢复对应会话投影

## 10. 受影响文件（第一批）

### 核心逻辑

- `src/renderer/src/hooks/use-chat-actions.ts`
- `src/renderer/src/stores/agent-store.ts`
- `src/renderer/src/stores/chat-store.ts`
- `src/renderer/src/stores/ui-store.ts`
- `src/renderer/src/App.tsx`（若需要挂全局 inbox/toast 订阅）

### 布局/UI

- `src/renderer/src/components/layout/SessionListPanel.tsx`
- `src/renderer/src/components/layout/TopBar.tsx`
- `src/renderer/src/components/layout/TitleBar.tsx`
- `src/renderer/src/components/layout/RightPanel.tsx`
- `src/renderer/src/components/layout/SubAgentsPanel.tsx`
- `src/renderer/src/components/layout/SubAgentExecutionDetail.tsx`
- `src/renderer/src/components/layout/OrchestrationConsole.tsx`

### 工具/上下文目标

- `src/renderer/src/components/chat/AssistantMessage.tsx`
- `src/renderer/src/components/chat/AskUserQuestionCard.tsx`
- `src/renderer/src/lib/tools/preview-tool.ts`
- `src/renderer/src/lib/tools/ask-user-tool.ts`（若要加入后台 blocked metadata）

### 新增模块（建议）

- `src/renderer/src/lib/agent/session-runtime-router.ts`
- `src/renderer/src/stores/background-session-store.ts`
- `src/renderer/src/components/layout/PendingInboxPopover.tsx`

## 11. 实施顺序

### Phase 1：执行态拆层（先解耦）

1. 新增 session runtime router
2. 将 `use-chat-actions.ts` 的事件处理改成先路由
3. 为当前会话保留 foreground sink
4. 为后台会话引入 background sink
5. 替换 `clearToolCalls()` 为 session-scoped reset/hydrate API

### Phase 2：跨会话摘要与 blocked 数据模型

1. `agent-store` 增加 per-session status / unread / blocked selectors
2. 新增全局 inbox store/model
3. `OpenPreview` 背景模式改为 queue item 而非直接开 panel
4. approvals / AskUserQuestion / desktop / foreground bash 统一走 blocked item

### Phase 3：UI 接入

1. `SessionListPanel` 显示状态图标 + 计数
2. `TopBar` / `TitleBar` 增加 inbox 入口
3. 顶部运行态改为只读当前会话
4. 点击 inbox item 后切 session 并深链到对应上下文

### Phase 4：Team / SubAgent 对齐

1. SubAgent / Team execution state 不再污染全局当前 UI
2. Orchestration / SubAgent 面板按当前会话投影显示
3. 切会话时恢复对应会话 live projection

### Phase 5：性能兜底与清理

1. 检查后台缓冲是否需要 ring-buffer 上限
2. 检查 unread / blocked 清理时机
3. 复核 dormant release 与 background buffer 共存逻辑
4. 去掉遗留的全局 live selector 依赖

## 12. 验证计划

### 功能验证

1. 同时运行 2 / 5 / 10+ 会话
2. 当前会话实时流正常
3. 后台会话不抢预览、不抢审批、不抢问答卡、不污染顶部状态
4. 后台会话触发：
   - AskUserQuestion
   - approval
   - OpenPreview
   - desktop / foreground bash
   时都能进入 blocked + inbox
5. 点击 inbox item：
   - 正确切会话
   - 正确打开目标上下文
6. 切入后台运行中会话：
   - 看到最新完整状态
   - 后续继续实时流
7. Team / SubAgent 在前后台切换时状态一致

### 性能验证

1. 10+ 并发 session 下：
   - 当前会话输入与滚动不卡顿
   - 会话切换延迟可接受
   - 顶部栏/侧栏无明显抖动
2. 观察 renderer 内存与 commit 次数是否显著下降
3. 确认非当前会话的 token 流不再触发大量无关 React 重渲染

### 基础校验

- `npm run lint`
- `npm run typecheck`
- 必要时 `npm run dev` 手工 smoke test

## 13. 风险与注意事项

### 风险 1：token 级完整过程 + 10+ 并发 的内存压力

缓解：

- 后台过程不走响应式树
- 对 sub-agent transcript / process output 做 ring-buffer 或长度上限
- 对 UI 只暴露摘要和最近状态

### 风险 2：当前大量组件默认依赖“active session + 全局 live store”

缓解：

- 先建立 router + hydrate 抽象
- 再逐步替换消费点
- 避免一次性大爆炸改动

### 风险 3：blocked item 与原有 approval / AskUserQuestion promise 生命周期耦合

缓解：

- 给 blocked item 明确定义 `pending -> surfaced -> resumed -> resolved` 生命周期
- 把 session switch / context open 视为“resume 前置动作”，而不是直接 resolve

### 风险 4：`OpenPreview` 与当前 preview panel 全局状态冲突

缓解：

- 后台永不直接 `openFilePreview`
- 改由 pending inbox 触发显式打开

## 14. 建议的第一步实现切口

优先做最关键的结构切口，而不是先画 UI：

1. 把 `use-chat-actions.ts` 里的 agent event 统一收口到 router
2. 去掉 `clearToolCalls()` 的全局语义，改成 session-scoped live state
3. 让后台 session 不再高频写当前响应式 live store
4. 在这个基础上再接 session list 计数和 inbox UI

这样能先解决性能根因，再补交互层。
