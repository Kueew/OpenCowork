# 修复会话切换后未自动滚动到底部

## 目标
用户切换到某个已有会话时，聊天视图应自动定位到消息底部；不保留上一次阅读位置。当前问题是：`MessageList` 只在“会话进行中”或满足特定自动滚动条件时主动跟随，历史会话切换进入后可能停留在非底部位置。

## 已确认的项目事实
- 自动滚动逻辑集中在 `src/renderer/src/components/chat/MessageList.tsx`。
- `MessageList` 内已有 `scrollToBottomImmediate`、`requestScrollToBottom`、`syncBottomState` 等逻辑。
- `MessageList` 在首次进入某个会话时，会根据 `isSessionRunning` 决定是否强制滚到底部；若会话未运行，则只同步底部状态。
- `chat-store.ts` 的 `setActiveSession` 会在切换会话时加载最近消息，`MessageList` 随后渲染新会话内容。
- `Layout.tsx` 里已有会话切换快捷键，最终同样会走 `setActiveSession`。

## 处理思路
1. 复查 `MessageList.tsx` 的首次进入分支，确认导致“历史会话切换不滚到底部”的具体条件。
2. 让“切换到已有会话”这个场景在首次渲染完成后统一执行一次强制滚底，而不是只依赖 `isSessionRunning`。
3. 保留现有流式输出跟随、用户手动上滚后的抑制逻辑，以及加载更早消息时的滚动位置恢复。
4. 验证切换会话、切换后重新渲染、以及流式输出中的底部跟随都不被破坏。

## 预计修改点
- `src/renderer/src/components/chat/MessageList.tsx`
  - 调整首次进入会话后的滚动触发条件。
  - 必要时增加“切换会话后首次强制到底部”的判定状态。
- 如需要，再检查 `chat-store.ts` 是否已有会话切换标记可复用；避免在 store 层引入重复状态。

## 验证
- 本地切换多个已有会话，确认每次进入都落到底部。
- 打开正在流式输出的会话，确认仍能自动跟随到底部。
- 手动向上滚动后，切换到别的会话再切回，仍按需求强制回到底部。
- 如需进一步确认，再跑 `npm run lint` / `npm run typecheck`。
