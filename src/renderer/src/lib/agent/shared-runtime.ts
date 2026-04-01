import { nanoid } from 'nanoid'
import { runAgentLoop } from './agent-loop'
import type { AgentEvent, AgentLoopConfig, LoopEndReason, ToolCallState } from './types'
import type { ContentBlock, ToolResultContent, TokenUsage, UnifiedMessage } from '../api/types'
import type { ToolContext } from '../tools/tool-types'

export type SharedAgentRuntimeReason = LoopEndReason | 'shutdown'

export interface SharedAgentRuntimeState {
  iteration: number
  toolCallCount: number
  toolCalls: ToolCallState[]
  usage: TokenUsage
  aggregatedText: string
  currentAssistantText: string
  lastAssistantText: string
  finalLoopReason: LoopEndReason | null
}

export interface SharedAgentRuntimeControl {
  stop?: boolean
  reason?: SharedAgentRuntimeReason
}

export interface SharedAgentRuntimeHookArgs {
  event: AgentEvent
  state: Readonly<SharedAgentRuntimeState>
  buildToolResultMessage: typeof buildToolResultMessage
}

export interface SharedAgentRuntimeOptions {
  initialMessages: UnifiedMessage[]
  loopConfig: AgentLoopConfig
  toolContext: ToolContext
  isReadOnlyTool?: (toolName: string) => boolean
  onApprovalNeeded?: (toolCall: ToolCallState) => Promise<boolean>
  hooks?: {
    beforeHandleEvent?: (
      args: SharedAgentRuntimeHookArgs
    ) => Promise<SharedAgentRuntimeControl | void> | SharedAgentRuntimeControl | void
    afterHandleEvent?: (
      args: SharedAgentRuntimeHookArgs
    ) => Promise<SharedAgentRuntimeControl | void> | SharedAgentRuntimeControl | void
  }
}

export interface SharedAgentRuntimeResult {
  reason: SharedAgentRuntimeReason
  iterations: number
  toolCallCount: number
  toolCalls: ToolCallState[]
  usage: TokenUsage
  aggregatedText: string
  finalOutput: string
  error?: string
}

export async function runSharedAgentRuntime(
  options: SharedAgentRuntimeOptions
): Promise<SharedAgentRuntimeResult> {
  const { initialMessages, loopConfig, toolContext, isReadOnlyTool, onApprovalNeeded, hooks } =
    options

  const state: SharedAgentRuntimeState = {
    iteration: 0,
    toolCallCount: 0,
    toolCalls: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    aggregatedText: '',
    currentAssistantText: '',
    lastAssistantText: '',
    finalLoopReason: null
  }

  let stopReason: SharedAgentRuntimeReason | null = null
  let errorMessage: string | undefined

  const buildHookArgs = (event: AgentEvent): SharedAgentRuntimeHookArgs => ({
    event,
    state,
    buildToolResultMessage
  })

  const applyControl = (control?: SharedAgentRuntimeControl | void): boolean => {
    if (!control?.stop) return false
    stopReason = control.reason ?? stopReason ?? 'completed'
    return true
  }

  const commitAssistantText = (): void => {
    const trimmed = state.currentAssistantText.trim()
    if (trimmed) {
      state.lastAssistantText = trimmed
    }
    state.currentAssistantText = ''
  }

  try {
    const loop = runAgentLoop(initialMessages, loopConfig, toolContext, async (toolCall) => {
      if (isReadOnlyTool?.(toolCall.name)) return true
      if (onApprovalNeeded) return onApprovalNeeded(toolCall)
      return false
    })

    for await (const event of loop) {
      if (toolContext.signal.aborted) {
        stopReason = 'aborted'
        break
      }

      if (applyControl(await hooks?.beforeHandleEvent?.(buildHookArgs(event)))) {
        break
      }

      switch (event.type) {
        case 'iteration_start':
          commitAssistantText()
          state.iteration = event.iteration
          break

        case 'text_delta':
          state.aggregatedText += event.text
          state.currentAssistantText += event.text
          break

        case 'tool_call_start':
        case 'tool_call_result': {
          if (event.type === 'tool_call_result') {
            state.toolCallCount += 1
          }
          const idx = state.toolCalls.findIndex((toolCall) => toolCall.id === event.toolCall.id)
          if (idx >= 0) {
            state.toolCalls[idx] = event.toolCall
          } else {
            state.toolCalls.push(event.toolCall)
          }
          break
        }

        case 'message_end':
          if (event.usage) {
            mergeTokenUsage(state.usage, event.usage)
          }
          break

        case 'iteration_end':
          commitAssistantText()
          break

        case 'loop_end':
          commitAssistantText()
          state.finalLoopReason = event.reason
          break

        case 'error':
          errorMessage = event.error.message
          stopReason = 'error'
          break
      }

      if (applyControl(await hooks?.afterHandleEvent?.(buildHookArgs(event)))) {
        break
      }

      if (event.type === 'error') {
        break
      }
    }
  } catch (error) {
    stopReason = 'error'
    errorMessage = error instanceof Error ? error.message : String(error)
  } finally {
    commitAssistantText()
  }

  const reason =
    stopReason ?? (toolContext.signal.aborted ? 'aborted' : (state.finalLoopReason ?? 'completed'))

  return {
    reason,
    iterations: state.iteration,
    toolCallCount: state.toolCallCount,
    toolCalls: [...state.toolCalls],
    usage: { ...state.usage },
    aggregatedText: state.aggregatedText,
    finalOutput:
      state.lastAssistantText || state.currentAssistantText.trim() || state.aggregatedText.trim(),
    ...(errorMessage ? { error: errorMessage } : {})
  }
}

export function mergeTokenUsage(target: TokenUsage, usage: TokenUsage): void {
  target.inputTokens += usage.inputTokens
  target.outputTokens += usage.outputTokens
  if (usage.billableInputTokens != null) {
    target.billableInputTokens = (target.billableInputTokens ?? 0) + usage.billableInputTokens
  }
  if (usage.cacheCreationTokens) {
    target.cacheCreationTokens = (target.cacheCreationTokens ?? 0) + usage.cacheCreationTokens
  }
  if (usage.cacheReadTokens) {
    target.cacheReadTokens = (target.cacheReadTokens ?? 0) + usage.cacheReadTokens
  }
  if (usage.reasoningTokens) {
    target.reasoningTokens = (target.reasoningTokens ?? 0) + usage.reasoningTokens
  }
}

export function buildToolResultMessage(
  toolResults: { toolUseId: string; content: ToolResultContent; isError?: boolean }[]
): UnifiedMessage {
  const content: ContentBlock[] = toolResults.map((result) => ({
    type: 'tool_result',
    toolUseId: result.toolUseId,
    content: result.content,
    ...(result.isError ? { isError: true } : {})
  }))

  return {
    id: nanoid(),
    role: 'user',
    content,
    createdAt: Date.now()
  }
}
