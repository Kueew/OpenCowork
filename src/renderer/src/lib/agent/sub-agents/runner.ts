import { nanoid } from 'nanoid'
import { toolRegistry } from '../tool-registry'
import type { AgentLoopConfig } from '../types'
import type { SubAgentRunConfig, SubAgentResult } from './types'
import { createSubAgentPromptMessage } from './input-message'
import { buildRuntimeCompression } from '../context-compression-runtime'
import { resolveSubAgentTools } from './resolve-tools'
import { buildToolResultMessage, runSharedAgentRuntime } from '../shared-runtime'

const READ_ONLY_SET = new Set(['Read', 'LS', 'Glob', 'Grep', 'TaskList', 'TaskGet', 'Skill'])

/**
 * Run a SubAgent — executes an inner agent loop with a focused system prompt
 * and restricted tool set, then returns a consolidated result.
 *
 * SubAgents auto-approve read-only tools. Write tools bubble approval up
 * to the parent via onApprovalNeeded callback.
 */
export async function runSubAgent(config: SubAgentRunConfig): Promise<SubAgentResult> {
  const { definition, parentProvider, toolContext, input, toolUseId, onEvent, onApprovalNeeded } =
    config

  const innerAbort = new AbortController()
  const onParentAbort = (): void => innerAbort.abort()
  toolContext.signal.addEventListener('abort', onParentAbort, { once: true })

  const promptMessage = createSubAgentPromptMessage(input, Date.now(), definition.initialPrompt)
  onEvent?.({
    type: 'sub_agent_start',
    subAgentName: definition.name,
    toolUseId,
    input,
    promptMessage
  })

  const { tools: innerTools, invalidTools } = resolveSubAgentTools(
    definition,
    toolRegistry.getDefinitions()
  )

  const innerProvider = {
    ...parentProvider,
    systemPrompt: definition.systemPrompt,
    model: definition.model ?? parentProvider.model,
    temperature: definition.temperature ?? parentProvider.temperature
  }

  const compression = buildRuntimeCompression(innerProvider, innerAbort.signal)

  const loopConfig: AgentLoopConfig = {
    maxIterations: definition.maxTurns,
    provider: innerProvider,
    tools: innerTools,
    systemPrompt: definition.systemPrompt,
    workingFolder: toolContext.workingFolder,
    signal: innerAbort.signal,
    ...(compression ? { contextCompression: compression } : {})
  }

  const loopToolContext = {
    ...toolContext,
    signal: innerAbort.signal,
    callerAgent: definition.name
  }

  const invalidToolsSuffix = invalidTools.length
    ? ` Unavailable tools: ${invalidTools.join(', ')}.`
    : ''

  const buildResult = (
    success: boolean,
    runtime: {
      finalOutput: string
      aggregatedText: string
      toolCallCount: number
      iterations: number
      usage: SubAgentResult['usage']
    },
    error?: string
  ): SubAgentResult => {
    const baseOutput = success
      ? runtime.finalOutput
      : runtime.finalOutput || runtime.aggregatedText.trim()
    const output =
      success && definition.formatOutput
        ? definition.formatOutput({
            success: true,
            output: baseOutput,
            reportSubmitted: !!baseOutput.trim(),
            toolCallCount: runtime.toolCallCount,
            iterations: runtime.iterations,
            usage: runtime.usage
          })
        : baseOutput
    const hasOutput = !!output.trim()

    onEvent?.({
      type: 'sub_agent_report_update',
      subAgentName: definition.name,
      toolUseId,
      report: output,
      status: hasOutput ? 'submitted' : 'missing'
    })

    return {
      success,
      output,
      reportSubmitted: hasOutput,
      toolCallCount: runtime.toolCallCount,
      iterations: runtime.iterations,
      usage: runtime.usage,
      ...(error ? { error } : {})
    }
  }

  try {
    if (innerTools.length === 0) {
      const result = buildResult(
        false,
        {
          finalOutput: '',
          aggregatedText: '',
          toolCallCount: 0,
          iterations: 0,
          usage: { inputTokens: 0, outputTokens: 0 }
        },
        `No tools available for sub-agent.${invalidTools.length > 0 ? ` Requested: ${invalidTools.join(', ')}` : ''}`
      )
      onEvent?.({ type: 'sub_agent_end', subAgentName: definition.name, toolUseId, result })
      return result
    }

    const runtime = await runSharedAgentRuntime({
      initialMessages: [promptMessage],
      loopConfig,
      toolContext: loopToolContext,
      isReadOnlyTool: (toolName) => READ_ONLY_SET.has(toolName),
      onApprovalNeeded,
      hooks: {
        afterHandleEvent: async ({ event, state }) => {
          switch (event.type) {
            case 'iteration_start':
              onEvent?.({
                type: 'sub_agent_iteration',
                subAgentName: definition.name,
                toolUseId,
                iteration: state.iteration,
                assistantMessage: {
                  id: nanoid(),
                  role: 'assistant',
                  content: '',
                  createdAt: Date.now()
                }
              })
              break

            case 'thinking_delta':
              onEvent?.({
                type: 'sub_agent_thinking_delta',
                subAgentName: definition.name,
                toolUseId,
                thinking: event.thinking
              })
              break

            case 'thinking_encrypted':
              onEvent?.({
                type: 'sub_agent_thinking_encrypted',
                subAgentName: definition.name,
                toolUseId,
                thinkingEncryptedContent: event.thinkingEncryptedContent,
                thinkingEncryptedProvider: event.thinkingEncryptedProvider
              })
              break

            case 'text_delta':
              onEvent?.({
                type: 'sub_agent_text_delta',
                subAgentName: definition.name,
                toolUseId,
                text: event.text
              })
              break

            case 'image_generated':
              onEvent?.({
                type: 'sub_agent_image_generated',
                subAgentName: definition.name,
                toolUseId,
                imageBlock: event.imageBlock
              })
              break

            case 'image_error':
              onEvent?.({
                type: 'sub_agent_image_error',
                subAgentName: definition.name,
                toolUseId,
                imageError: event.imageError
              })
              break

            case 'tool_use_streaming_start':
              onEvent?.({
                type: 'sub_agent_tool_use_streaming_start',
                subAgentName: definition.name,
                toolUseId,
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                toolCallExtraContent: event.toolCallExtraContent
              })
              break

            case 'tool_use_args_delta':
              onEvent?.({
                type: 'sub_agent_tool_use_args_delta',
                subAgentName: definition.name,
                toolUseId,
                toolCallId: event.toolCallId,
                partialInput: event.partialInput
              })
              break

            case 'tool_use_generated':
              onEvent?.({
                type: 'sub_agent_tool_use_generated',
                subAgentName: definition.name,
                toolUseId,
                toolUseBlock: {
                  type: 'tool_use',
                  id: event.toolUseBlock.id,
                  name: event.toolUseBlock.name,
                  input: event.toolUseBlock.input,
                  ...(event.toolUseBlock.extraContent
                    ? { extraContent: event.toolUseBlock.extraContent }
                    : {})
                }
              })
              break

            case 'message_end':
              onEvent?.({
                type: 'sub_agent_message_end',
                subAgentName: definition.name,
                toolUseId,
                usage: event.usage,
                providerResponseId: event.providerResponseId
              })
              break

            case 'tool_call_start':
            case 'tool_call_result':
              onEvent?.({
                type: 'sub_agent_tool_call',
                subAgentName: definition.name,
                toolUseId,
                toolCall: event.toolCall
              })
              break

            case 'iteration_end':
              if (event.toolResults && event.toolResults.length > 0) {
                onEvent?.({
                  type: 'sub_agent_tool_result_message',
                  subAgentName: definition.name,
                  toolUseId,
                  message: buildToolResultMessage(event.toolResults)
                })
              }
              break
          }
        }
      }
    })

    const error = runtime.error ? `${runtime.error}${invalidToolsSuffix}` : undefined
    const success = runtime.reason !== 'error' && runtime.reason !== 'aborted'
    const result = buildResult(success, runtime, error)
    onEvent?.({ type: 'sub_agent_end', subAgentName: definition.name, toolUseId, result })
    return result
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    const result = buildResult(
      false,
      {
        finalOutput: '',
        aggregatedText: '',
        toolCallCount: 0,
        iterations: 0,
        usage: { inputTokens: 0, outputTokens: 0 }
      },
      `${errMsg}${invalidToolsSuffix}`
    )
    onEvent?.({ type: 'sub_agent_end', subAgentName: definition.name, toolUseId, result })
    return result
  } finally {
    innerAbort.abort()
    toolContext.signal.removeEventListener('abort', onParentAbort)
  }
}
