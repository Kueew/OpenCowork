import type {
  ContentBlock,
  ToolResultContent,
  ToolUseBlock,
  UnifiedMessage
} from '@renderer/lib/api/types'
import { isEditableUserMessage } from '@renderer/lib/image-attachments'
import {
  isCompactBoundaryMessage,
  isCompactSummaryLikeMessage
} from '@renderer/lib/agent/context-compression'

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
const transcriptStaticAnalysisCache = new WeakMap<UnifiedMessage[], TranscriptStaticAnalysis>()
const HIDDEN_MESSAGE_LIST_TOOL_NAMES = new Set(['TaskCreate', 'TaskUpdate'])

export interface TranscriptStaticAnalysis {
  messageLookup: Map<string, UnifiedMessage>
  toolResultsLookup: Map<string, Map<string, { content: ToolResultContent; isError?: boolean }>>
  renderableMessageIds: string[]
  lastRealUserMessageId: string | null
  lastAssistantMessageId: string | null
  tailToolExecutionState: TailToolExecutionState | null
  orchestrationBindingSignature: string
}

export function isToolResultOnlyUserMessage(message: UnifiedMessage): boolean {
  return (
    message.role === 'user' &&
    Array.isArray(message.content) &&
    message.content.every((block) => block.type === 'tool_result')
  )
}

function isRealUserMessage(message: UnifiedMessage): boolean {
  return isEditableUserMessage(message) && !isCompactSummaryLikeMessage(message)
}

function hasVisibleAssistantBlock(block: ContentBlock): boolean {
  if (block.type === 'tool_use') {
    return !HIDDEN_MESSAGE_LIST_TOOL_NAMES.has(block.name)
  }

  if (block.type === 'text') {
    return block.text.trim().length > 0
  }

  return true
}

function shouldRenderInMessageList(message: UnifiedMessage): boolean {
  if (message.role === 'system') return isCompactBoundaryMessage(message)
  if (isToolResultOnlyUserMessage(message)) return false
  if (message.role !== 'assistant' || !Array.isArray(message.content)) return true
  return message.content.some(hasVisibleAssistantBlock)
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

function buildOrchestrationMessageBindingEntry(message: UnifiedMessage): string {
  if (message.role !== 'assistant') {
    return `${message.id}:${message.role}`
  }

  if (!Array.isArray(message.content)) {
    return `${message.id}:${message.role}:string`
  }

  const toolUseSignature = message.content
    .filter(
      (block): block is Extract<ContentBlock, { type: 'tool_use' }> => block.type === 'tool_use'
    )
    .map((block) => {
      const teamName = typeof block.input.team_name === 'string' ? block.input.team_name.trim() : ''
      const runsInBackground = block.input.run_in_background === true ? 'bg' : 'fg'
      return `${block.id}:${block.name}:${teamName}:${runsInBackground}`
    })
    .join(',')

  return `${message.id}:${message.role}:blocks:${message.content.length}:${toolUseSignature}`
}

function buildTailToolExecutionState(messages: UnifiedMessage[]): TailToolExecutionState | null {
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

export function buildTranscriptStaticAnalysis(
  messages: UnifiedMessage[]
): TranscriptStaticAnalysis {
  const cached = transcriptStaticAnalysisCache.get(messages)
  if (cached) return cached

  const messageLookup = new Map<string, UnifiedMessage>()
  const toolResultsLookup = new Map<
    string,
    Map<string, { content: ToolResultContent; isError?: boolean }>
  >()
  const renderableMessageIds: string[] = []
  const orchestrationBindingEntries: string[] = []
  let currentAssistantMessageId: string | null = null
  let lastRealUserMessageId: string | null = null
  let lastAssistantMessageId: string | null = null

  for (const message of messages) {
    messageLookup.set(message.id, message)
    orchestrationBindingEntries.push(buildOrchestrationMessageBindingEntry(message))

    if (message.role === 'assistant') {
      currentAssistantMessageId = message.id
    } else if (isToolResultOnlyUserMessage(message) && currentAssistantMessageId) {
      let results = toolResultsLookup.get(currentAssistantMessageId)
      if (!results) {
        results = new Map()
        toolResultsLookup.set(currentAssistantMessageId, results)
      }
      collectToolResults(message.content as ContentBlock[], results)
    } else {
      currentAssistantMessageId = null
    }

    if (!shouldRenderInMessageList(message)) continue

    renderableMessageIds.push(message.id)
    if (isRealUserMessage(message)) {
      lastRealUserMessageId = message.id
    }
    if (message.role === 'assistant') {
      lastAssistantMessageId = message.id
    }
  }

  const nextAnalysis: TranscriptStaticAnalysis = {
    messageLookup,
    toolResultsLookup,
    renderableMessageIds,
    lastRealUserMessageId,
    lastAssistantMessageId,
    tailToolExecutionState: buildTailToolExecutionState(messages),
    orchestrationBindingSignature: orchestrationBindingEntries.join('|')
  }

  transcriptStaticAnalysisCache.set(messages, nextAnalysis)
  return nextAnalysis
}

export function buildRenderableMessageMetaFromAnalysis(
  analysis: TranscriptStaticAnalysis,
  streamingMessageId: string | null
): RenderableMessageMeta[] {
  const lastRealUserMessageId = streamingMessageId ? null : analysis.lastRealUserMessageId

  return analysis.renderableMessageIds.map((messageId) => ({
    messageId,
    isLastUserMessage: messageId === lastRealUserMessageId,
    isLastAssistantMessage: messageId === analysis.lastAssistantMessageId
  }))
}

export function buildChatRenderableMessageMetaFromAnalysis(
  analysis: TranscriptStaticAnalysis,
  streamingMessageId: string | null,
  continueAssistantMessageId: string | null
): ChatRenderableMessageMeta[] {
  return buildRenderableMessageMetaFromAnalysis(analysis, streamingMessageId).map((message) => ({
    ...message,
    showContinue: message.messageId === continueAssistantMessageId
  }))
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
  return buildTailToolExecutionState(messages)
}

export function buildRenderableMessageMeta(
  messages: UnifiedMessage[],
  streamingMessageId: string | null
): RenderableMessageMeta[] {
  return buildRenderableMessageMetaFromAnalysis(
    buildTranscriptStaticAnalysis(messages),
    streamingMessageId
  )
}

export function buildChatRenderableMessageMeta(
  messages: UnifiedMessage[],
  streamingMessageId: string | null,
  continueAssistantMessageId: string | null
): ChatRenderableMessageMeta[] {
  return buildChatRenderableMessageMetaFromAnalysis(
    buildTranscriptStaticAnalysis(messages),
    streamingMessageId,
    continueAssistantMessageId
  )
}
