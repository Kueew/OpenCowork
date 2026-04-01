import { nanoid } from 'nanoid'
import { toolRegistry } from '../tool-registry'
import { teamEvents } from './events'
import { useTeamStore } from '../../../stores/team-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useProviderStore } from '../../../stores/provider-store'
import { ensureProviderAuthReady } from '../../auth/provider-auth'
import { useAgentStore } from '../../../stores/agent-store'
import { ipcClient } from '../../ipc/ipc-client'
import { MessageQueue } from '../types'
import type { AgentLoopConfig } from '../types'
import type { UnifiedMessage, ProviderConfig, TokenUsage } from '../../api/types'
import type { TeamMessage, TeamTask } from './types'
import { buildRuntimeCompression } from '../context-compression-runtime'
import { subAgentRegistry } from '../sub-agents/registry'
import { resolveSubAgentTools } from '../sub-agents/resolve-tools'
import { runSharedAgentRuntime } from '../shared-runtime'

// --- AbortController registry for individual teammates ---
const teammateAbortControllers = new Map<string, AbortController>()

// --- Graceful shutdown registry ---
// When a shutdown_request is received, the teammate finishes its current
// iteration and then stops — instead of hard aborting mid-tool-call.
const teammateShutdownRequested = new Set<string>()
// 0 => unlimited iterations (teammate stops only on completion/shutdown/error/abort)
const DEFAULT_TEAMMATE_MAX_ITERATIONS = 0

/**
 * Request graceful shutdown: teammate finishes current iteration then stops.
 */
export function requestTeammateShutdown(memberId: string): void {
  teammateShutdownRequested.add(memberId)
}

/**
 * Abort a running teammate by member ID (hard stop).
 * Returns true if the teammate was found and aborted.
 */
export function abortTeammate(memberId: string): boolean {
  const ac = teammateAbortControllers.get(memberId)
  if (ac) {
    ac.abort()
    teammateAbortControllers.delete(memberId)
    teammateShutdownRequested.delete(memberId)
    return true
  }
  return false
}

/** Abort all running teammates (e.g. on TeamDelete). */
export function abortAllTeammates(): void {
  for (const [id, ac] of teammateAbortControllers) {
    ac.abort()
    teammateAbortControllers.delete(id)
  }
  teammateShutdownRequested.clear()
}

/** Check if a teammate is still running. */
export function isTeammateRunning(memberId: string): boolean {
  return teammateAbortControllers.has(memberId)
}

interface RunTeammateOptions {
  memberId: string
  memberName: string
  prompt: string
  taskId: string | null
  model: string | null
  agentName: string | null
  workingFolder?: string
}

/**
 * Start an independent agent loop for a teammate.
 * Runs in background (fire-and-forget). Updates team-store via teamEvents.
 *
 * Each teammate executes a single assigned task then stops.
 * The framework-level scheduler (in create-tool.ts) handles
 * auto-dispatching the next pending task to a new teammate
 * when a concurrency slot frees up.
 *
 * On completion (or error), the teammate automatically sends a summary
 * message to the lead so the lead's context includes the result without
 * needing to poll. The lead is auto-notified via SendMessage.
 */
export async function runTeammate(options: RunTeammateOptions): Promise<void> {
  const { memberId, memberName, model, agentName, workingFolder } = options
  let { prompt, taskId } = options

  const abortController = new AbortController()
  teammateAbortControllers.set(memberId, abortController)

  // Exclude team management tools from teammate (only lead should manage team).
  // TaskCreate is excluded because teammates should not create new tasks.
  // Note: Task tool is kept but run_in_background is guarded inside executeBackgroundTeammate.
  const LEAD_ONLY_TOOLS = new Set(['TeamCreate', 'TeamDelete', 'TaskCreate'])
  const baseToolDefs = toolRegistry
    .getDefinitions()
    .filter((tool) => !LEAD_ONLY_TOOLS.has(tool.name))
  const agentDefinition = agentName ? subAgentRegistry.get(agentName) : undefined
  const toolDefs = agentDefinition
    ? resolveSubAgentTools(agentDefinition, baseToolDefs).tools
    : baseToolDefs

  // Message queue: receives messages from lead/other teammates and injects
  // them into the agent loop at iteration boundaries (between turns).
  const messageQueue = new MessageQueue()

  // Listen for team messages targeting this teammate
  const unsubMessages = teamEvents.on((event) => {
    if (event.type !== 'team_message') return
    const msg = event.message
    const isForMe = msg.to === memberName || msg.to === 'all'
    if (!isForMe) return
    if (msg.from === memberName) return

    if (msg.type === 'shutdown_request') {
      teammateShutdownRequested.add(memberId)
    } else {
      messageQueue.push({
        id: nanoid(),
        role: 'user',
        content: `[Team message from ${msg.from}]: ${msg.content}`,
        createdAt: msg.timestamp
      })
    }
  })

  let totalIterations = 0
  let totalToolCalls = 0
  let tasksCompleted = 0
  let lastStreamingText = ''
  let fullOutput = ''
  let endReason: 'completed' | 'aborted' | 'error' | 'shutdown' = 'completed'

  try {
    if (!taskId) {
      const initialTask = findNextClaimableTask()
      if (initialTask) {
        taskId = initialTask.id
        prompt = `Work on the following task:\n**Subject:** ${initialTask.subject}\n**Description:** ${initialTask.description}\n\nAdditional context from lead:\n${prompt}`
        teamEvents.emit({
          type: 'team_task_update',
          taskId: initialTask.id,
          patch: { status: 'in_progress', owner: memberName }
        })
        teamEvents.emit({
          type: 'team_member_update',
          memberId,
          patch: { currentTaskId: initialTask.id }
        })
      }
    }

    const result = await runSingleTaskLoop({
      memberId,
      memberName,
      prompt,
      taskId,
      model,
      workingFolder,
      abortController,
      toolDefs,
      messageQueue,
      agentName
    })

    totalIterations = result.iterations
    totalToolCalls = result.toolCalls
    lastStreamingText = result.lastStreamingText
    fullOutput = result.fullOutput
    if (result.taskCompleted) tasksCompleted++
    if (result.reason === 'aborted') endReason = 'aborted'
    else if (result.reason === 'shutdown') endReason = 'shutdown'
    else if (result.reason === 'error') endReason = 'error'

    teamEvents.emit({
      type: 'team_member_update',
      memberId,
      patch: { status: 'stopped', completedAt: Date.now() }
    })
  } catch (error) {
    endReason = 'error'
    if (!abortController.signal.aborted) {
      console.error(`[Teammate ${memberName}] Error:`, error)
    }
    teamEvents.emit({
      type: 'team_member_update',
      memberId,
      patch: { status: 'stopped', completedAt: Date.now() }
    })
  } finally {
    teammateAbortControllers.delete(memberId)
    teammateShutdownRequested.delete(memberId)
    unsubMessages()

    if (endReason !== 'aborted') {
      emitCompletionMessage(memberName, endReason, {
        totalIterations,
        totalToolCalls,
        tasksCompleted,
        lastStreamingText,
        fullOutput,
        taskId
      })
    }
  }
}

// ── Single task execution ──────────────────────────────────────────

interface SingleTaskResult {
  iterations: number
  toolCalls: number
  lastStreamingText: string
  fullOutput: string
  taskCompleted: boolean
  reason: 'completed' | 'max_iterations' | 'aborted' | 'shutdown' | 'error'
  usage: TokenUsage
}

async function runSingleTaskLoop(opts: {
  memberId: string
  memberName: string
  prompt: string
  taskId: string | null
  model: string | null
  agentName: string | null
  workingFolder?: string
  abortController: AbortController
  toolDefs: ReturnType<typeof toolRegistry.getDefinitions>
  messageQueue?: MessageQueue
}): Promise<SingleTaskResult> {
  const {
    memberId,
    memberName,
    prompt,
    taskId,
    model,
    agentName,
    workingFolder,
    abortController,
    toolDefs,
    messageQueue
  } = opts

  const settings = useSettingsStore.getState()
  const providerState = useProviderStore.getState()
  const activeProviderId = providerState.activeProviderId
  if (activeProviderId) {
    const ready = await ensureProviderAuthReady(activeProviderId)
    if (!ready) {
      throw new Error('Provider authentication required. Please sign in.')
    }
  }

  const activeConfig = providerState.getActiveProviderConfig()
  const effectiveModel =
    model && model !== 'default' ? model : (activeConfig?.model ?? settings.model)
  const effectiveMaxTokens = useProviderStore
    .getState()
    .getEffectiveMaxTokens(settings.maxTokens, effectiveModel)
  const providerConfig: ProviderConfig = activeConfig
    ? {
        ...activeConfig,
        model: effectiveModel,
        maxTokens: effectiveMaxTokens,
        temperature: settings.temperature
      }
    : {
        type: settings.provider,
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl || undefined,
        model: effectiveModel,
        maxTokens: effectiveMaxTokens,
        temperature: settings.temperature
      }

  if (toolDefs.length === 0) {
    throw new Error(
      agentName
        ? `No tools available for teammate agent "${agentName}".`
        : 'No tools available for teammate.'
    )
  }

  const team = useTeamStore.getState().activeTeam
  const taskInfo = taskId && team ? team.tasks.find((task) => task.id === taskId) : null
  const agentDefinition = agentName ? subAgentRegistry.get(agentName) : undefined
  const effectivePrompt = agentDefinition?.initialPrompt
    ? `${agentDefinition.initialPrompt}\n\n${prompt}`
    : prompt

  const coordinationPrompt = buildTeammateSystemPrompt({
    memberName,
    teamName: team?.name ?? 'team',
    prompt: effectivePrompt,
    task: taskInfo
      ? { id: taskInfo.id, subject: taskInfo.subject, description: taskInfo.description }
      : null,
    workingFolder,
    language: settings.language
  })
  const systemPrompt = agentDefinition
    ? `${agentDefinition.systemPrompt}\n\n${coordinationPrompt}`
    : coordinationPrompt
  providerConfig.systemPrompt = systemPrompt

  const compression = buildRuntimeCompression(providerConfig, abortController.signal)

  const loopConfig: AgentLoopConfig = {
    maxIterations: agentDefinition?.maxTurns ?? DEFAULT_TEAMMATE_MAX_ITERATIONS,
    provider: providerConfig,
    tools: toolDefs,
    systemPrompt,
    workingFolder,
    signal: abortController.signal,
    messageQueue,
    ...(compression ? { contextCompression: compression } : {})
  }

  const userMsg: UnifiedMessage = {
    id: nanoid(),
    role: 'user',
    content: effectivePrompt,
    createdAt: Date.now()
  }

  teamEvents.emit({
    type: 'team_member_update',
    memberId,
    patch: { status: 'working', iteration: 0 }
  })

  let streamingText = ''
  let taskCompleted = false

  const STREAM_THROTTLE_MS = 200
  let streamDirty = false
  let streamTimer: ReturnType<typeof setTimeout> | null = null

  const flushStreamingText = (): void => {
    if (streamTimer) {
      clearTimeout(streamTimer)
      streamTimer = null
    }
    if (!streamDirty) return
    streamDirty = false
    teamEvents.emit({
      type: 'team_member_update',
      memberId,
      patch: { streamingText }
    })
  }

  const runtime = await runSharedAgentRuntime({
    initialMessages: [userMsg],
    loopConfig,
    toolContext: {
      workingFolder,
      signal: abortController.signal,
      ipc: ipcClient,
      callerAgent: 'teammate'
    },
    isReadOnlyTool: (toolName) => READ_ONLY_TOOLS.has(toolName),
    onApprovalNeeded: async (toolCall) => {
      const autoApprove = useSettingsStore.getState().autoApprove
      if (autoApprove) return true
      const approved = useAgentStore.getState().approvedToolNames
      if (approved.includes(toolCall.name)) return true
      const result = await useAgentStore.getState().requestApproval(toolCall.id)
      if (result) useAgentStore.getState().addApprovedTool(toolCall.name)
      return result
    },
    hooks: {
      beforeHandleEvent: ({ event }) => {
        if (event.type !== 'iteration_start') return

        if (teammateShutdownRequested.has(memberId)) {
          return { stop: true, reason: 'shutdown' }
        }

        if (!taskId) return undefined
        const currentTeam = useTeamStore.getState().activeTeam
        const currentTask = currentTeam?.tasks.find((task) => task.id === taskId)
        if (currentTask?.status === 'completed') {
          taskCompleted = true
          return { stop: true, reason: 'completed' }
        }
        return undefined
      },
      afterHandleEvent: async ({ event, state }) => {
        switch (event.type) {
          case 'iteration_start':
            streamingText = ''
            flushStreamingText()
            teamEvents.emit({
              type: 'team_member_update',
              memberId,
              patch: { iteration: state.iteration, status: 'working', streamingText: '' }
            })
            break

          case 'text_delta':
            streamingText += event.text
            streamDirty = true
            if (!streamTimer) {
              streamTimer = setTimeout(flushStreamingText, STREAM_THROTTLE_MS)
            }
            break

          case 'tool_call_approval_needed': {
            const willAutoApprove =
              useSettingsStore.getState().autoApprove ||
              useAgentStore.getState().approvedToolNames.includes(event.toolCall.name)
            if (!willAutoApprove) {
              useAgentStore.getState().addToolCall(event.toolCall)
            }
            break
          }

          case 'tool_call_start':
          case 'tool_call_result':
            flushStreamingText()
            teamEvents.emit({
              type: 'team_member_update',
              memberId,
              patch: { toolCalls: [...state.toolCalls] }
            })
            break

          case 'message_end':
            if (event.usage) {
              teamEvents.emit({
                type: 'team_member_update',
                memberId,
                patch: { usage: { ...state.usage } }
              })
            }
            break

          case 'loop_end':
            flushStreamingText()
            if ((event.reason === 'completed' || event.reason === 'max_iterations') && taskId) {
              teamEvents.emit({
                type: 'team_task_update',
                taskId,
                patch: { status: 'completed' }
              })
              taskCompleted = true
            }
            break
        }
      }
    }
  })

  if (streamTimer) {
    clearTimeout(streamTimer)
    streamTimer = null
  }
  flushStreamingText()

  const resolvedOutput = runtime.finalOutput

  if (taskId && resolvedOutput) {
    const currentTask = useTeamStore.getState().activeTeam?.tasks.find((task) => task.id === taskId)
    if (!currentTask?.report?.trim()) {
      teamEvents.emit({
        type: 'team_task_update',
        taskId,
        patch: { report: resolvedOutput }
      })
    }
  }

  return {
    iterations: runtime.iterations,
    toolCalls: runtime.toolCallCount,
    lastStreamingText: streamingText,
    fullOutput: resolvedOutput,
    taskCompleted,
    reason: runtime.reason,
    usage: runtime.usage
  }
}

// ── Auto-claim: find next unassigned, unblocked pending task ──────

export function findNextClaimableTask(): TeamTask | null {
  const team = useTeamStore.getState().activeTeam
  if (!team) return null

  const completedTaskIds = new Set(
    team.tasks.filter((task) => task.status === 'completed').map((task) => task.id)
  )

  for (const task of team.tasks) {
    if (task.status !== 'pending') continue
    if (task.owner) continue

    const allDepsCompleted = task.dependsOn.every((depId) => completedTaskIds.has(depId))
    if (!allDepsCompleted) continue

    return task
  }

  return null
}

// ── Auto-notify: send completion summary to lead ─────────────────

const MAX_REPORT_LENGTH = 4000

function emitCompletionMessage(
  memberName: string,
  endReason: string,
  stats: {
    totalIterations: number
    totalToolCalls: number
    tasksCompleted: number
    lastStreamingText: string
    fullOutput: string
    taskId: string | null
  }
): void {
  const team = useTeamStore.getState().activeTeam
  if (!team) return

  const header = [
    `**${memberName}** finished (${endReason}).`,
    `Iterations: ${stats.totalIterations}, Tool calls: ${stats.totalToolCalls}, Tasks completed: ${stats.tasksCompleted}.`
  ].join(' ')

  const task = stats.taskId ? team.tasks.find((item) => item.id === stats.taskId) : null
  const reportText = task?.report || stats.fullOutput || stats.lastStreamingText
  let report = ''
  if (reportText) {
    if (reportText.length <= MAX_REPORT_LENGTH) {
      report = `\n\n## Report\n${reportText}`
    } else {
      report = `\n\n## Report\n${reportText.slice(-MAX_REPORT_LENGTH)}\n\n*(report truncated, showing last ${MAX_REPORT_LENGTH} chars of ${reportText.length} total)*`
    }
  }

  const content = header + report

  const message: TeamMessage = {
    id: nanoid(8),
    from: memberName,
    to: 'lead',
    type: 'message',
    content,
    summary: `${memberName} finished (${endReason}): ${stats.tasksCompleted} tasks, ${stats.totalToolCalls} tool calls`,
    timestamp: Date.now()
  }

  teamEvents.emit({ type: 'team_message', message })
}

// --- Helpers ---

const READ_ONLY_TOOLS = new Set(['Read', 'LS', 'Glob', 'Grep', 'TaskList', 'TaskGet', 'TeamStatus'])

function buildTeammateSystemPrompt(options: {
  memberName: string
  teamName: string
  prompt: string
  task: { id: string; subject: string; description: string } | null
  workingFolder?: string
  language?: string
}): string {
  const { memberName, teamName, prompt, task, workingFolder, language } = options

  const parts: string[] = []

  parts.push(
    `You are "${memberName}", a teammate agent in the "${teamName}" team.`,
    `You are part of a multi-agent team working in parallel on a shared codebase.`,
    `You should focus exclusively on your assigned work and avoid modifying files outside your scope.`,
    `**You MUST respond in ${language === 'zh' ? 'Chinese (中文)' : 'English'} unless explicitly instructed otherwise.**`
  )

  if (task) {
    parts.push(
      `\n## Your Task`,
      `**ID:** ${task.id}`,
      `**Subject:** ${task.subject}`,
      `**Description:** ${task.description}`
    )
  }

  parts.push(`\n## Instructions\n${prompt}`)

  if (workingFolder) {
    parts.push(`\n## Working Folder\n\`${workingFolder}\``)
    parts.push(`All relative paths should be resolved against this folder.`)
  }

  parts.push(
    `\n## Coordination Rules`,
    `- Only modify files related to your assigned task.`,
    `- When your task is done, call TaskUpdate with status="completed" to finalize task state.`,
    `- Use SendMessage to communicate with the lead or other teammates if needed.`,
    `- Never spawn another background teammate. If parallel help is needed, message the lead instead.`,
    `- After completing your task, you will stop. The framework will automatically assign remaining pending tasks to new teammates.`,
    `- If you receive a shutdown request, finish your current work promptly and stop.`,
    `- Be concise and efficient — you have limited iterations.`,
    `\n## Final Output`,
    `IMPORTANT: Your last assistant message should clearly summarize what you completed, what changed, and any follow-up the lead should know.`,
    `Mark task status correctly with the TaskUpdate tool when your assigned work is done:`,
    `\`TaskUpdate(task_id="...", status="completed")\``
  )

  return parts.join('\n')
}
