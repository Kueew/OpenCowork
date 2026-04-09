import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { Brain, ChevronRight, Clock, Maximize2, icons } from 'lucide-react'
'
import { useAgentStore } from '@renderer/stores/agent-store'
import { decodeStructuredToolResult } from '@renderer/lib/tools/tool-result-format'
import { useUIStore } from '@renderer/stores/ui-store'
import { formatTokens, getBillableTotalTokens } from '@renderer/lib/format-tokens'
import { cn } from '@renderer/lib/utils'
import { parseSubAgentMeta } from '@renderer/lib/agent/sub-agents/create-tool'
import { subAgentRegistry } from '@renderer/lib/agent/sub-agents/registry'
import type { ToolResultContent } from '@renderer/lib/api/types'

function getSubAgentIcon(agentName: string): React.ReactNode {
  const def = subAgentRegistry.get(agentName)
  if (def?.icon && def.icon in icons) {
    const IconComp = icons[def.icon as keyof typeof icons]
    return <IconComp className="size-4" />
  }
  return <Brain className="size-4" />
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const secs = ms / 1000
  if (secs < 60) return `${secs.toFixed(1)}s`
  return `${Math.floor(secs / 60)}m${Math.round(secs % 60)}s`
}

export const SubAgentCard = React.memo(SubAgentCardInner)

interface SubAgentCardProps {
  name: string
  toolUseId: string
  input: Record<string, unknown>
  output?: ToolResultContent
  isLive?: boolean
}

function SubAgentCardInner({
  name,
  toolUseId,
  input,
  output,
  isLive = false
}: SubAgentCardProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  void isLive

  const displayName = String(input.subagent_type ?? name)
  const tracked = useAgentStore(
    useShallow((s) => {
      const item =
        s.activeSubAgents[toolUseId] ??
        s.completedSubAgents[toolUseId] ??
        s.subAgentHistory.find((entry) => entry.toolUseId === toolUseId) ??
        null

      if (!item) return null

      return {
        isRunning: item.isRunning,
        success: item.success,
        errorMessage: item.errorMessage,
        iteration: item.iteration,
        toolCallCount: item.toolCalls.length,
        usage: item.usage ?? null,
        startedAt: item.startedAt,
        completedAt: item.completedAt
      }
    })
  )

  const outputStr = typeof output === 'string' ? output : undefined
  const parsed = React.useMemo(() => {
    if (!outputStr) return { meta: null, text: '' }
    return parseSubAgentMeta(outputStr)
  }, [outputStr])
  const histMeta = parsed.meta
  const histText = parsed.text || outputStr || ''

  const usage = tracked?.usage ?? histMeta?.usage ?? null
  const isRunning = tracked?.isRunning ?? false
  const isCompleted = !isRunning && (!!output || !!tracked)
  const historicalError = outputStr
    ? (() => {
        const parsedOutput = decodeStructuredToolResult(outputStr)
        if (
          parsedOutput &&
          !Array.isArray(parsedOutput) &&
          typeof parsedOutput.error === 'string'
        ) {
          return true
        }
        const parsedHistText = decodeStructuredToolResult(histText)
        return !!(
          parsedHistText &&
          !Array.isArray(parsedHistText) &&
          typeof parsedHistText.error === 'string'
        )
      })()
    : false
  const isError = tracked?.success === false || !!tracked?.errorMessage || historicalError

  const [now, setNow] = React.useState(tracked?.startedAt ?? 0)
  React.useEffect(() => {
    if (!tracked?.isRunning) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [tracked?.isRunning, tracked?.startedAt])

  const elapsed = tracked
    ? (tracked.completed  const descriptionText = input.description ? String(input.description) : ''
  const promptText = [
    input.prompt ? String(input.prompt) : '',
    input.query ? String(input.query) : '',
    input.task ? String(input.task) : '',
    input.target ? String(input.target) : ''
  ]
    .filter(Boolean)
    .join(' · ')

  const handleOpenPanel = (): void => {
    useUIStore.getState().openSubAgentExecutionDetail(toolUseId, histText || undefined)
  }

  const iterationCount = tracked?.iteration ?? histMeta?.iterations ?? 0

    .filter(Boolean)
    .join(' · ')

  const  const iterationCount = tracked?.iteration ?? histMeta?.iterations ?? 0
  const callCount = tracked?.toolCallCount ?? histMeta?.toolCalls.length ?? 0
  const totalTokens = usage ? formatTokens(getBillableTotalTokens(usage)) : null
  const statusText = isRunning
    ? t('subAgent.working')
    : isError
      ? t('subAgent.failed')
      : t('subAgent.done')
  const previewText = descriptionText || promptText
  const orderLabel = toolUseId.slice(-2).toUpperCase()
  const meterCount = Math.max(10, Math.min(24, callCount > 0 ? callCount : iterationCount || 12))

  return (
    <div
      className={cn(
        'my-2 overflow-hidden rounded-2xl border px-3 py-3 transition-colors',
        'bg-[#171717] border-white/6 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]',
        isCompleted && !isError && 'border-white/10',
        isError && 'border-destructive/30 bg-[#1b1414]',
        isRunning && 'border-emerald-500/20'
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full border text-white/90',
            isRunning ? 'border-emerald-400/35 bg-emerald-400/10' : 'border-white/10 bg-white/5'
          )}
        >
          {icon}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-[14px] font-semibold text-white/92">{displayName}</span>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-medium',
                    isRunning && 'bg-emerald-400/12 text-emerald-300',
                    !isRunning && !isError && 'bg-cyan-400/10 text-cyan-300',
                    isError && 'bg-destructive/12 text-destructive'
                  )}
                >
                  {statusText}
                </span>
              </div>
              {previewText ? (
                <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-[12px] leading-5 text-white/58">
                  {previewText}
                </p>
              ) : null}
            </div>

            <div className="flex shrink-0 items-start gap-2">
              <span className="pt-0.5 text-xs font-semibold tabular-nums text-white/65">
                {orderLabel}
              </span>
              <button
                onClick={handleOpenPanel}
                className="rounded-full p-1.5 text-white/45 transition-colors hover:bg-white/6 hover:text-white/85"
                title={t('subAgent.viewDetails')}
              >
                <Maximize2 className="size-3.5" />
              </button>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-white/42">
            {elapsed != null ? (
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Clock className="size-3" />
                {formatElapsed(elapsed)}
              </span>
            ) : null}
            {iterationCount > 0 ? <span>{t('subAgent.iter', { count: iterationCount })}</span> : null}
            {callCount > 0 ? <span>{t('subAgent.calls', { count: callCount })}</span> : null}
            {totalTokens ? <span>{totalTokens} tok</span> : null}
          </div>

          <div className="mt-2 flex items-center justify-between gap-3">
            <div className="flex items-end gap-1.5">
              {Array.from({ length: meterCount }).map((_, index) => {
                const active = isRunning || index < meterCount - (isError ? 8 : 0)
                return (
                  <span
                    key={index}
                    className={cn(
                      'block h-1.5 w-[4px] rounded-[2px] transition-colors',
                      active
                        ? isError
                          ? 'bg-destructive/80'
                          : 'bg-emerald-400/85'
                        : 'bg-white/10'
                    )}
                  />
                )
              })}
            </div>

            <button
              onClick={handleOpenPanel}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-white/55 transition-colors hover:text-white/88"
            >
              {t('subAgent.viewDetails')}
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
