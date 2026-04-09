# SubAgent / Team Orchestration UI 重构计划

## 1. 已确认目标

基于现有代码与澄清结果，本次改造目标如下：

- 彻底重做 SubAgent / Team 的前端展示与交互，不沿用当前小卡片设计。
- MessageList 改为 **按一次用户轮次聚合的 orchestration block**，不再以单个 tool_use 卡片为主要心智模型。
- Team 与普通 SubAgent 统一为一套展示体系：普通 SubAgent 视作单人成团。
- 聊天区只展示 **紧凑摘要**，深度信息转移到右侧统一的 **Team 总控台**。
- 右侧收敛现有 `SubAgentsPanel` / `SubAgentExecutionDetail` / `DetailPanel` 的重复路径，形成单一架构。
- 历史消息中的 orchestration block 必须可回放，而不是只保留摘要。
- 允许新增 view-model / store / 兼容层 / 必要事件补充，以优先保证架构正确性与性能。
- 性能重点是 **长会话滚动性能**，其次保证运行中更新不产生明显抖动。

## 2. 当前实现与问题梳理

### 2.1 当前聊天区

相关文件：
- `src/renderer/src/components/chat/AssistantMessage.tsx`
- `src/renderer/src/components/chat/SubAgentCard.tsx`
- `src/renderer/src/components/chat/TeamEventCard.tsx`
- `src/renderer/src/components/chat/MessageList.tsx`
- `src/renderer/src/components/chat/MessageItem.tsx`

现状：
- Team 相关工具 (`TeamCreate`, `TaskCreate`, `TaskUpdate`, 后台 `Task`) 显示为 `TeamEventCard` 事件流。
- 普通 `Task`（非后台 teammate）显示为 `SubAgentCard`。
- MessageList 已做虚拟列表，但每个 orchestration 相关节点仍作为独立消息内容插入聊天流。

问题：
- 同一轮用户触发的团队协作被拆散成多个 tool 卡片，信息架构是“底层执行日志”，不是“团队编排态”。
- Team 与普通 SubAgent 是两套不同 UI 语义，不利于统一认知。
- 聊天区承载过多中间执行细节，长会话中可读性和滚动效率会下降。

### 2.2 当前右侧

相关文件：
- `src/renderer/src/components/layout/RightPanel.tsx`
- `src/renderer/src/components/layout/SubAgentsPanel.tsx`
- `src/renderer/src/components/layout/SubAgentExecutionDetail.tsx`
- `src/renderer/src/components/layout/DetailPanel.tsx`
- `src/renderer/src/components/cowork/TeamPanel.tsx`
- `src/renderer/src/components/layout/right-panel-defs.ts`

现状：
- `subagents` 是右侧独立 tab。
- `team` 也是独立 tab。
- `DetailPanel.tsx` 中还保留另一套 team/subagent detail 能力。
- `SubAgentExecutionDetail` 与 `SubAgentsPanel` 之间通过 UI store 组合工作。

问题：
- 存在重复入口与重复信息结构。
- “团队总览”和“单 agent 详情”分散在多个面板，没有稳定主路径。
- 用户要求“右侧改成总控台”，现有结构不匹配。

### 2.3 当前数据层

相关文件：
- `src/renderer/src/stores/agent-store.ts`
- `src/renderer/src/stores/team-store.ts`
- `src/renderer/src/lib/agent/teams/types.ts`

现有可用数据：
- SubAgent：`report / transcript / toolCalls / streamingText / usage / iteration / startedAt / completedAt`
- Team：`members / tasks / messages / description / runtime meta / history`

问题：
- 缺少“面向 UI 的聚合层”，当前视图直接消费原始 store。
- 缺少稳定的 orchestration run / round 级别视图模型。
- 阶段导航（如 2/5）目前没有明确状态源，需要补一层推导或显式状态。

### 2.4 性能风险点

已识别的风险：
- 多个组件中对每个卡片或成员独立使用 `setInterval` 更新时间。
- 右侧与聊天区直接订阅大 store 对象，容易造成不必要 rerender。
- 历史 transcript / markdown / tool list 直接渲染在列表中成本高。
- 当前 MessageList 虽已虚拟化，但 orchestration UI 仍缺少“轻量摘要 + 惰性详情”的彻底分层。

## 3. 重构后的目标架构

## 3.1 总体信息架构

### 聊天区（MessageList）
引入新的 **OrchestrationBlock** 概念：
- 以“用户轮次”为边界聚合该轮内的 Team/SubAgent 执行。
- 在聊天区只渲染一张轻量摘要块。
- 摘要块内展示：
  - 标题（单人代理 / 团队编排）
  - 当前阶段 / 阶段进度
  - 成员数量 / 完成数量 / 运行状态
  - 简要任务摘要或最近动作
  - CTA：查看详情 / 打开总控台
- 不在聊天区直接渲染完整 transcript/tool timeline。

### 右侧（Team Console）
收敛为统一的 **Orchestration Console**：
- 顶部：本次 orchestration 的标题、状态、阶段导航。
- 主体：当前选中 agent 的轨迹视图（优先）。
- 底部或侧边：agent 切换条（单人代理时显示 1 个 agent）。
- 次级信息：团队任务、成员状态、消息流、最终摘要。

### 历史回放
- orchestration block 记录足够的引用信息或快照信息，保证历史消息中点击后仍能恢复相应总控台视图。
- 历史回放优先读取聚合快照；若当前 store 仍有 live 数据，则可合并增强显示。

## 3.2 统一实体模型

新增面向 UI 的 Orchestration View Model，不直接让 MessageList 依赖 `SubAgentState` / `ActiveTeam` 原始结构。

建议新增概念：
- `OrchestrationRun`
  - `id`
  - `sessionId`
  - `sourceMessageId` / `userTurnId`
  - `kind: 'single-agent' | 'team'`
  - `title`
  - `status: 'running' | 'completed' | 'failed'`
  - `stageIndex` / `stageCount`
  - `stageItems[]`
  - `members[]`
  - `selectedMemberId`（UI 可选）
  - `summary`
  - `startedAt` / `completedAt`
  - `historySnapshot`
- `OrchestrationMember`
  - 统一映射 TeamMember / SubAgentState
  - `id / name / role / status / currentTask / summary / progress / usage / transcriptRef / toolCallsRef`
- `OrchestrationStage`
  - `id / label / status / derivedFrom`

实现方式：
- 对 Team：从 `team-store` + 消息轮次聚合结果构建。
- 对普通 SubAgent：将单个 `SubAgentState` 包装为 1-member orchestration。

## 3.3 阶段模型

用户允许补协议，但第一步优先建立“可推导 + 可扩展”的机制：

第一版阶段推导建议：
1. 创建执行单元（TeamCreate / SubAgent spawn）
2. 分配任务（TaskCreate / owner changes）
3. 执行中（成员 working / tool calls / transcript）
4. 汇总结果（report available / messages / final output）
5. 完成（all done or failed terminal state）

若现有数据无法稳定覆盖：
- 在聚合层中增加 stage resolver；
- 必要时在 tool/event bridge 中补充 `orchestration_run_start / update / complete` 兼容事件，但第一实施阶段优先先不改底层 runtime。

## 4. 具体实施方案

## 4.1 新增聚合层（优先）

新增建议文件：
- `src/renderer/src/lib/orchestration/types.ts`
- `src/renderer/src/lib/orchestration/build-runs.ts`
- `src/renderer/src/lib/orchestration/build-history-snapshot.ts`
- `src/renderer/src/lib/orchestration/stage-resolver.ts`
- `src/renderer/src/stores/orchestration-store.ts`（如有必要）

职责：
- 从 `UnifiedMessage[]`、`agent-store`、`team-store` 中构建 MessageList 与右侧所需的轻量视图模型。
- 以“用户轮次”作为聚合边界。
- 为每个 block 生成稳定 id。
- 为历史回放生成快照，减少未来对 live store 的强依赖。

关键策略：
- 聚合函数尽量纯函数化，便于 memo 和缓存。
- 使用基于 `sessionId + message ids + toolUseIds` 的信号缓存，避免每次 render 全量重算。
- 聚合结果中只保留 MessageList 所需摘要字段，重详情放在详情数据 getter 中延迟获取。

## 4.2 重做聊天区展示

改造目标文件：
- `src/renderer/src/components/chat/AssistantMessage.tsx`
- `src/renderer/src/components/chat/MessageItem.tsx`
- `src/renderer/src/components/chat/MessageList.tsx`

新增建议组件：
- `src/renderer/src/components/chat/OrchestrationBlock.tsx`
- `src/renderer/src/components/chat/OrchestrationMemberStrip.tsx`
- `src/renderer/src/components/chat/OrchestrationStagePills.tsx`

设计原则：
- 在 `AssistantMessage` 中拦截 orchestration 相关 tool_use，不再逐个输出 `SubAgentCard` / `TeamEventCard`。
- 由聚合层返回当前 assistant message 所属的 orchestration block，并将相关原始卡片隐藏或合并。
- block 默认只显示：
  - 标题
  - 阶段进度
  - 成员/子代理状态摘要
  - 一条最新动作或最终结论
  - 查看详情按钮
- 对普通 SubAgent，渲染单人成团版 block，保持交互一致。

需要处理的技术点：
- 防止同一轮的多个 assistant message 重复渲染同一个 block。
- 与现有 tool_result 追踪逻辑兼容。
- 历史消息滚动时避免展开重内容。

## 4.3 收敛右侧为统一总控台

改造目标文件：
- `src/renderer/src/components/layout/RightPanel.tsx`
- `src/renderer/src/components/layout/SubAgentsPanel.tsx`
- `src/renderer/src/components/layout/SubAgentExecutionDetail.tsx`
- `src/renderer/src/components/cowork/TeamPanel.tsx`
- `src/renderer/src/components/layout/DetailPanel.tsx`
- `src/renderer/src/stores/ui-store.ts`
- `src/renderer/src/components/layout/right-panel-defs.ts`

新增建议组件：
- `src/renderer/src/components/layout/OrchestrationConsole.tsx`
- `src/renderer/src/components/layout/OrchestrationHeader.tsx`
- `src/renderer/src/components/layout/OrchestrationMemberDock.tsx`
- `src/renderer/src/components/layout/OrchestrationTimeline.tsx`
- `src/renderer/src/components/layout/OrchestrationTaskOverview.tsx`

收敛方向：
- 保留右侧一个 collaboration 主路径；内部由 `OrchestrationConsole` 统一处理单人/团队。
- 弱化或移除当前 `subagents` / `team` 双轨 tab 的概念；至少在实现上共用一套主组件。
- 点击聊天区 block 时，右侧打开并定位到对应 orchestration run。
- 当前 member 切换、阶段切换、轨迹查看都在这一个总控台内完成。

建议 UI 结构：
- 顶部：标题 / 状态 / 阶段 pills / 最近动作
- 中部：选中成员轨迹（tool calls、transcript、summary）
- 底部：成员切换 dock
- 折叠区：任务总览 / 团队消息 / 运行元信息

## 4.4 UI 状态改造

`ui-store.ts` 需要从“选中单个 subagent”升级为“选中 orchestration run + member”的状态模型。

建议替换或新增状态：
- `selectedOrchestrationRunId: string | null`
- `selectedOrchestrationMemberId: string | null`
- `orchestrationConsoleOpen: boolean`
- `orchestrationConsoleView: 'overview' | 'member' | 'tasks'`

兼容策略：
- 先保留旧字段一阶段兼容（如 `selectedSubAgentToolUseId`）。
- 在新入口中优先写入新字段，并在 bridge 函数中映射旧字段。
- 完成重构后清理旧字段与旧调用方。

## 4.5 历史回放与快照

必须实现：
- 当某个 orchestration 已结束且 live store 不再完整时，仍可从历史消息回放。

实现建议：
- 在聚合层构建历史快照对象，记录：
  - block 摘要信息
  - member 列表和任务摘要
  - 选中成员所需的 transcript/tool refs 或紧凑副本
  - 最终 summary/report
- 快照大小控制：
  - MessageList 用极简摘要快照
  - 详情回放按需读取 agent/team store 的 compact history；若不存在再回退到消息内 snapshot

## 5. 性能方案

本次必须把性能作为架构内建能力，而不是事后优化。

### 5.1 MessageList 轻量化

- orchestration block 在消息列表里只渲染摘要，不渲染 transcript、完整 tool cards、完整 markdown。
- 对运行中 block 的动态字段做最小订阅，只订阅：状态、阶段、最近动作、成员统计。
- 避免每个 block 内单独 `setInterval`，改为：
  - 全局共享 ticker；或
  - 仅在右侧详情里显示动态时间；聊天区不显示秒级更新时间。

### 5.2 Store 订阅拆分

- 为 orchestration UI 提供 selector hooks，避免大对象订阅。
- 不让列表项直接订阅整个 `agent-store` / `team-store`。
- 通过 view-model store 或 memoized selectors 输出稳定引用，减少 `React.memo` 失效。

### 5.3 详情惰性渲染

- 右侧未打开时，不构建完整 transcript markdown tree。
- 未选中的成员，不渲染其完整轨迹。
- tool timeline 使用折叠与窗口化策略（如必要时局部虚拟化）。

### 5.4 历史数据压缩

- 沿用 `agent-store` 现有 compact history 策略，但为 orchestration 增加摘要级 snapshot。
- 历史 block 恢复时先显示轻量摘要，再异步加载深层内容。

## 6. 分阶段实施顺序

### Phase 1：数据聚合与 UI 状态基建
1. 新增 orchestration types/builders/stage resolver
2. 建立“按用户轮次聚合”的 run 构建逻辑
3. 扩展 `ui-store`，加入 run/member 选中状态
4. 保持现有 UI 不变，先接入新聚合层并完成单元验证/手工验证

### Phase 2：聊天区替换
1. 新建 `OrchestrationBlock`
2. 在 `AssistantMessage` 中聚合替换 Team/SubAgent 原有卡片输出
3. 保证普通 SubAgent 与 Team 统一展示
4. 做 MessageList 长列表验证

### Phase 3：右侧总控台重构
1. 新建 `OrchestrationConsole`
2. 迁移 `SubAgentExecutionDetail` 的轨迹能力到新控制台
3. 迁移 `TeamPanel` 的成员/任务/消息能力到新控制台
4. 在 `RightPanel` 中将 collaboration 区收敛到统一入口

### Phase 4：兼容清理
1. 清理旧 `SubAgentCard` / `TeamEventCard` 主要路径
2. 精简 `SubAgentsPanel` / `DetailPanel` 重复逻辑
3. 清理旧 UI store 字段与过时入口
4. 补充 i18n 文案

### Phase 5：验证与优化
1. `npm run typecheck`
2. `npm run lint`
3. 手工验证场景：
   - 单个 SubAgent
   - Team + 多成员并发
   - 长会话历史回放
   - 运行中切换右侧成员
   - 右侧关闭/打开与滚动性能

## 7. 需要注意的兼容与风险

### 风险 1：按用户轮次聚合可能与跨轮持续 Team 冲突
处理：
- 第一版严格按用户轮次聚合，符合当前已确认需求。
- run model 预留扩展位，未来可升级到 `teamId/runId` 聚合。

### 风险 2：历史快照体积膨胀
处理：
- block 级快照只保留摘要与必要 refs。
- transcript/tool calls 继续走 compact history，必要时才落轻量副本。

### 风险 3：现有代码路径多处直接依赖 `selectedSubAgentToolUseId`
处理：
- 先加兼容 bridge，不立即硬删。
- 等右侧新控制台完成后再移除旧入口。

### 风险 4：聊天区聚合后调试可见性下降
处理：
- 在总控台保留轨迹优先视图。
- 必要时在开发模式下保留原始执行日志折叠入口。

## 8. 交付定义

本次计划完成后，目标交付是：
- 用户在聊天区看到的是“团队编排块”而非一堆工具卡片。
- 点击后右侧打开统一 Team 总控台。
- Team 与单个 SubAgent 使用同一套 UI 范式。
- 长会话里滚动保持流畅，历史块可回放。
- 旧的重复右侧路径被收敛或兼容过渡。

## 9. 实施建议

建议按 Phase 1 → Phase 3 连续完成，不要先纯做视觉。
原因：
- 这次不是样式替换，而是信息架构重组。
- 若不先建立聚合层和统一状态模型，后面 UI 一定返工。
- 性能问题本质上依赖“摘要层/详情层拆分”，必须在架构层解决。
