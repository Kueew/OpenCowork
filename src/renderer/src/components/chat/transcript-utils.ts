import type {
  ContentBlock,
  ToolResultContent,
  ToolUseBlock,
  UnifiedMessage
} from '@renderer/lib/api/types'
import { isEditableUserMessage } from '@renderer/lib/image-attachments'

export interface RenderableMessageMeta {
  messageId: string
  isLastUserMessage: boolean
  isLastAssistantMessage: boolean
}

export interface ChatRenderableMessageMeta extends RenderableMessageMeta {
  showContinue: boolean
}

export interface TailToolExecutionState {
  assistantIndex: number
  assistantMessageId: string
  toolUseBlocks: ToolUseBlock[]
  toolResultMap: Map<string, { content: ToolResultContent; isError?: boolean }>
  trailingToolResultMessageCount: number
}

const messageLookupCache = new WeakMap<UnifiedMessage[], Map<string, UnifiedMessage>>()

export function isToolResultOnlyUserMessage(message: UnifiedMessage): boolean {
  return (
    message.role === 'user' &&
    Array.isArray(message.content) &&
    message.content.every((block) => block.type === 'tool_result')
  )
}

function isRealUserMessage(message: UnifiedMessage): boolean {
  return isEditableUserMessage(message)
}

function collectToolResults(
  blocks: ContentBlock[],
  target: Map<string, { content: ToolResultContent; isError?: boolean }>
): void {
  for (const block of blocks) {
    if (block.type === 'tool_result') {
      target.set(block.toolUseId, { content: block.content, isError: block.isError })
    }
  }
}

export function getToolResultsLookup(
  messages: UnifiedMessage[]
): Map<string, Map<string, { content: ToolResultContent; isError?: boolean }>> {
  const next = new Map<string, Map<string, { content: ToolResultContent; isError?: boolean }>>()
  let currentAssistantMessageId: string | null = null

  for (const message of messages) {
    if (message.role === 'assistant') {
      currentAssistantMessageId = message.id
      continue
    }

    if (isToolResultOnlyUserMessage(message) && currentAssistantMessageId) {
      let results = next.get(currentAssistantMessageId)
      if (!results) {
        results = new Map()
        next.set(currentAssistantMessageId, results)
      }
      collectToolResults(message.content as ContentBlock[], results)
      continue
    }

    currentAssistantMessageId = null
  }

  return next
}

export function getMessageLookup(messages: UnifiedMessage[]): Map<string, UnifiedMessage> {
  const cached = messageLookupCache.get(messages)
  if (cached) return cached

  const next = new Map<string, UnifiedMessage>()
  for (const message of messages) {
    next.set(message.id, message)
  }

  messageLookupCache.set(messages, next)
  return next
}

export function getTailToolExecutionState(
  messages: UnifiedMessage[]
): TailToolExecutionState | null {
  if (messages.length === 0) return null

  const toolResultMap = new Map<string, { content: ToolResultContent; isError?: boolean }>()
  let trailingToolResultMessageCount = 0
  let assistantIndex = messages.length - 1

  while (assistantIndex >= 0) {
    const message = messages[assistantIndex]
    if (!isToolResultOnlyUserMessage(message)) break
    collectToolResults(message.content as ContentBlock[], toolResultMap)
    trailingToolResultMessageCount += 1
    assistantIndex -= 1
  }

  if (assistantIndex < 0) return null

  const assistantMessage = messages[assistantIndex]
  if (assistantMessage.role !== 'assistant' || !Array.isArray(assistantMessage.content)) {
    return null
  }

  const toolUseBlocks = assistantMessage.content.filter(
    (block): block is ToolUseBlock => block.type === 'tool_use'
  )
  if (toolUseBlocks.length === 0) return null

  return {
    assistantIndex,
    assistantMessageId: assistantMessage.id,
    toolUseBlocks,
    toolResultMap,
    trailingToolResultMessageCount
  }
}

function resolveLastRealUserIndex(
  messages: UnifiedMessage[],
  streamingMessageId: string | null
): number {
  if (streamingMessageId) return -1

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isRealUserMessage(messages[index])) {
      return index
    }
  }

  return -1
}

function resolveLastAssistantIndex(messages: UnifiedMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (isToolResultOnlyUserMessage(message)) continue
    return message.role === 'assistant' ? index : -1
  }

  return -1
}

export function buildRenderableMessageMeta(
  messages: UnifiedMessage[],
  streamingMessageId: string | null
): RenderableMessageMeta[] {
  const lastRealUserIndex = resolveLastRealUserIndex(messages, streamingMessageId)
  const lastAssistantIndex = resolveLastAssistantIndex(messages)
  const result: RenderableMessageMeta[] = []

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (isToolResultOnlyUserMessage(message)) continue

    result.push({
      messageId: message.id,
      isLastUserMessage: index === lastRealUserIndex,
      isLastAssistantMessage: index === lastAssistantIndex
    })
  }

  return result
}

export function buildChatRenderableMessageMeta(
  messages: UnifiedMessage[],
  streamingMessageId: string | null,
  continueAssistantMessageId: string | null
): ChatRenderableMessageMeta[] {
  return buildRenderableMessageMeta(messages, streamingMessageId).map((message) => ({
    ...message,
    showContinue: message.messageId === continueAssistantMessageId
  }))
}
