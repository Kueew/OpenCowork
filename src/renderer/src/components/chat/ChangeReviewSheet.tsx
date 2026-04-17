import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, CheckCircle2, Copy, FileCode, Loader2, RotateCcw, X, XCircle } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Sheet, SheetContent } from '@renderer/components/ui/sheet'
import { MONO_FONT } from '@renderer/lib/constants'
import { IPC } from '@renderer/lib/ipc/channels'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { cn } from '@renderer/lib/utils'
import type { AgentRunChangeSet, AgentRunFileChange } from '@renderer/stores/agent-store'
import { useAgentStore } from '@renderer/stores/agent-store'
import { CodeDiffViewer } from './CodeDiffViewer'
import {
  buildDiffCopyText,
  canRenderInlineSnapshot,
  computeDiff,
  detectLang,
  fileName,
  foldContext,
  lineCount,
  snapshotText,
  summarizeTrackedChange
} from './file-change-utils'

interface ChangeReviewSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  changeSet: AgentRunChangeSet
  initialChangeId?: string | null
}

interface LoadedChangeContent {
  beforeText: string
  afterText: string
}

function actionLabelKey(change: AgentRunFileChange): 'fileChange.new' | 'fileChange.edited' {
  return change.op === 'create' ? 'fileChange.new' : 'fileChange.edited'
}

function isActionableChange(change: AgentRunFileChange): boolean {
  return change.status === 'open' || change.status === 'conflicted'
}

function statusLabelKey(
  change: AgentRunFileChange
):
  | 'fileChange.status.accepted'
  | 'fileChange.status.reverted'
  | 'fileChange.status.conflict'
  | 'fileChange.status.pending' {
  if (change.status === 'accepted') return 'fileChange.status.accepted'
  if (change.status === 'reverted') return 'fileChange.status.reverted'
  if (change.status === 'conflicted') return 'fileChange.status.conflict'
  return 'fileChange.status.pending'
}

function statusTone(change: AgentRunFileChange): string {
  if (change.status === 'accepted') {
    return 'text-emerald-300'
  }
  if (change.status === 'reverted') {
    return 'text-zinc-300'
  }
  if (change.status === 'conflicted') {
    return 'text-amber-300'
  }
  return 'text-sky-300'
}

function actionTone(): string {
  return 'text-zinc-400'
}

function transportTone(change: AgentRunFileChange): string {
  return change.transport === 'ssh' ? 'text-sky-300' : 'text-zinc-400'
}

function ActionLabel({ change }: { change: AgentRunFileChange }): React.JSX.Element {
  const { t } = useTranslation('chat')
  return (
    <span className={cn('inline-flex items-center text-[10px] font-medium', actionTone())}>
      {t(actionLabelKey(change))}
    </span>
  )
}

function CopyIconButton({ text }: { text: string }): React.JSX.Element {
  const { t } = useTranslation(['common'])
  const [copied, setCopied] = React.useState(false)

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="rounded-full text-zinc-400 hover:bg-white/[0.08] hover:text-white"
      onClick={() => {
        void navigator.clipboard.writeText(text)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      }}
      title={t('action.copy', { ns: 'common' })}
      aria-label={t('action.copy', { ns: 'common' })}
    >
      {copied ? <Check className="size-3 text-emerald-300" /> : <Copy className="size-3" />}
    </Button>
  )
}

function CodeFrame({
  content,
  maxHeight = 520
}: {
  content: string
  maxHeight?: number
}): React.JSX.Element {
  const lines = React.useMemo(() => content.split('\n'), [content])

  return (
    <div
      className="overflow-auto rounded-[18px] border border-white/8 bg-[#111214] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
      style={{ maxHeight, fontFamily: MONO_FONT }}
    >
      {lines.map((line, index) => (
        <div
          key={`${index}-${line.length}`}
          className="grid grid-cols-[56px_minmax(0,1fr)] border-b border-white/[0.04] text-[11px] leading-5 last:border-b-0"
        >
          <span className="select-none border-r border-white/[0.05] px-2 py-1 text-right text-zinc-600">
            {index + 1}
          </span>
          <span className="min-w-0 whitespace-pre-wrap break-all px-3 py-1 text-zinc-100">
            {line || ' '}
          </span>
        </div>
      ))}
    </div>
  )
}

function EmptyState(): React.JSX.Element {
  const { t } = useTranslation('chat')
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <FileCode className="size-8 text-zinc-500" />
      <div>
        <p className="text-sm font-medium text-zinc-100">
          {t('fileChange.reviewEmpty', { defaultValue: 'No file changes to review' })}
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          {t('fileChange.reviewEmptyHint', {
            defaultValue: 'Changed files and diffs will appear here for this run.'
          })}
        </p>
      </div>
    </div>
  )
}

function ChangeDetail({ change }: { change: AgentRunFileChange }): React.JSX.Element {
  const { t } = useTranslation('chat')
  const [loadedContent, setLoadedContent] = React.useState<LoadedChangeContent | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  const shouldLoadFullContent =
    change.op === 'create'
      ? !canRenderInlineSnapshot(change.after)
      : !canRenderInlineSnapshot(change.before) || !canRenderInlineSnapshot(change.after)

  React.useEffect(() => {
    if (!shouldLoadFullContent) {
      setLoadedContent(null)
      setLoadError(null)
      setIsLoading(false)
      return
    }

    let cancelled = false
    const load = async (): Promise<void> => {
      setIsLoading(true)
      setLoadError(null)
      try {
        const result = await ipcClient.invoke(IPC.AGENT_CHANGES_DIFF_CONTENT, {
          runId: change.runId,
          changeId: change.id
        })

        if (cancelled) return

        if (
          result &&
          typeof result === 'object' &&
          'beforeText' in result &&
          'afterText' in result &&
          typeof result.beforeText === 'string' &&
          typeof result.afterText === 'string'
        ) {
          setLoadedContent({
            beforeText: result.beforeText,
            afterText: result.afterText
          })
          return
        }

        if (
          result &&
          typeof result === 'object' &&
          'error' in result &&
          typeof result.error === 'string'
        ) {
          setLoadError(result.error)
          return
        }

        setLoadError(
          t('fileChange.loadDiffFailed', { defaultValue: 'Failed to load the full diff' })
        )
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [change, shouldLoadFullContent, t])

  const beforeText =
    loadedContent?.beforeText ?? (change.op === 'modify' ? snapshotText(change.before) : '')
  const afterText = loadedContent?.afterText ?? snapshotText(change.after)
  const diffLines = React.useMemo(
    () => (change.op === 'modify' ? computeDiff(beforeText, afterText) : []),
    [afterText, beforeText, change.op]
  )
  const diffChunks = React.useMemo(() => foldContext(diffLines), [diffLines])
  const diffCopyText = React.useMemo(() => buildDiffCopyText(diffLines), [diffLines])

  if (isLoading && !loadedContent && shouldLoadFullContent) {
    return (
      <div className="flex h-[320px] items-center justify-center rounded-[20px] border border-white/8 bg-[#111214] text-sm text-zinc-400">
        <Loader2 className="mr-2 size-4 animate-spin text-emerald-400" />
        {t('thinking.thinkingEllipsis')}
      </div>
    )
  }

  if (loadError && !loadedContent && shouldLoadFullContent) {
    return (
      <div className="rounded-[20px] border border-red-500/20 bg-red-500/10 px-4 py-4 text-sm text-red-200">
        {loadError}
      </div>
    )
  }

  if (change.op === 'create') {
    const copyText = afterText || change.after.previewText || ''
    const displayText = afterText || change.after.previewText || ''

    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
          <span className="text-[11px] text-emerald-300">{detectLang(change.filePath)}</span>
          <span>{t('fileChange.lineCount', { count: lineCount(displayText) })}</span>
          {copyText ? <CopyIconButton text={copyText} /> : null}
        </div>
        <CodeFrame content={displayText || change.after.previewText || ''} />
      </div>
    )
  }

  return (
    <CodeDiffViewer
      chunks={diffChunks}
      defaultMode="inline"
      toolbarEnd={diffCopyText ? <CopyIconButton text={diffCopyText} /> : null}
    />
  )
}

function ChangeRow({
  change,
  selected,
  onSelect
}: {
  change: AgentRunFileChange
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  const { t } = useTranslation(['chat', 'common'])
  const acceptFileChange = useAgentStore((state) => state.acceptFileChange)
  const rollbackFileChange = useAgentStore((state) => state.rollbackFileChange)
  const [isAccepting, setIsAccepting] = React.useState(false)
  const [isRollingBack, setIsRollingBack] = React.useState(false)
  const summary = React.useMemo(() => summarizeTrackedChange(change), [change])
  const actionable = isActionableChange(change)

  const handleAccept = async (): Promise<void> => {
    if (!actionable) return
    setIsAccepting(true)
    try {
      await acceptFileChange(change.runId, change.id)
    } finally {
      setIsAccepting(false)
    }
  }

  const handleRollback = async (): Promise<void> => {
    if (!actionable) return
    setIsRollingBack(true)
    try {
      await rollbackFileChange(change.runId, change.id)
    } finally {
      setIsRollingBack(false)
    }
  }

  return (
    <div className="px-2 py-0.5">
      <div
        className={cn(
          'group relative flex items-center gap-2 rounded-md px-2.5 py-2 transition-colors',
          selected ? 'bg-white/[0.03]' : 'hover:bg-white/[0.015]'
        )}
      >
        <button
          type="button"
          className="min-w-0 flex flex-1 items-center gap-1.5 text-left"
          onClick={onSelect}
          title={change.filePath}
        >
          <ActionLabel change={change} />
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-sky-300">
            {fileName(change.filePath)}
          </span>
          <span className="shrink-0 text-[10px] font-medium text-emerald-300">
            +{summary.added}
          </span>
          <span className="shrink-0 text-[10px] font-medium text-red-300">-{summary.deleted}</span>
        </button>

        {actionable ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="rounded-full text-zinc-500 hover:bg-white/[0.03] hover:text-white"
              onClick={() => void handleRollback()}
              disabled={isAccepting || isRollingBack}
              title={t('action.undo', { ns: 'common' })}
              aria-label={t('action.undo', { ns: 'common' })}
            >
              {isRollingBack ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <X className="size-3" />
              )}
            </Button>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="rounded-full text-emerald-300 hover:bg-white/[0.03] hover:text-emerald-200"
              onClick={() => void handleAccept()}
              disabled={isAccepting || isRollingBack}
              title={t('action.allow', { ns: 'common' })}
              aria-label={t('action.allow', { ns: 'common' })}
            >
              {isAccepting ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Check className="size-3" />
              )}
            </Button>
          </div>
        ) : change.status === 'accepted' ? (
          <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
        ) : change.status === 'reverted' ? (
          <RotateCcw className="size-4 shrink-0 text-zinc-500" />
        ) : (
          <XCircle className="size-4 shrink-0 text-amber-400" />
        )}
      </div>
    </div>
  )
}

interface ChangeReviewPanelContentProps {
  runId: string
  initialChangeId?: string | null
  changeSetOverride?: AgentRunChangeSet | null
}

export function ChangeReviewPanelContent({
  runId,
  initialChangeId = null,
  changeSetOverride = null
}: ChangeReviewPanelContentProps): React.JSX.Element {
  const { t } = useTranslation(['chat', 'common'])
  const storedChangeSet = useAgentStore((state) => state.runChangesByRunId[runId] ?? null)
  const refreshRunChanges = useAgentStore((state) => state.refreshRunChanges)
  const acceptRunChanges = useAgentStore((state) => state.acceptRunChanges)
  const rollbackRunChanges = useAgentStore((state) => state.rollbackRunChanges)
  const [selectedChangeId, setSelectedChangeId] = React.useState<string | null>(null)
  const [isAcceptingAll, setIsAcceptingAll] = React.useState(false)
  const [isRollingBackAll, setIsRollingBackAll] = React.useState(false)
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const requestedRunIdRef = React.useRef<string | null>(null)
  const lastFocusRequestRef = React.useRef<string | null>(null)
  const changeSet = changeSetOverride ?? storedChangeSet

  React.useEffect(() => {
    if (changeSetOverride || changeSet || requestedRunIdRef.current === runId) return

    let cancelled = false
    requestedRunIdRef.current = runId
    setIsRefreshing(true)

    void refreshRunChanges(runId).finally(() => {
      if (!cancelled) {
        setIsRefreshing(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [changeSet, changeSetOverride, refreshRunChanges, runId])

  React.useEffect(() => {
    if (!changeSet) {
      setSelectedChangeId(null)
      return
    }

    const focusKey = `${runId}:${initialChangeId ?? ''}`
    if (lastFocusRequestRef.current === focusKey) return
    lastFocusRequestRef.current = focusKey

    if (initialChangeId && changeSet.changes.some((change) => change.id === initialChangeId)) {
      setSelectedChangeId(initialChangeId)
      return
    }

    const preferred =
      changeSet.changes.find(
        (change) => change.status === 'open' || change.status === 'conflicted'
      ) ?? changeSet.changes[0]
    setSelectedChangeId(preferred?.id ?? null)
  }, [changeSet, initialChangeId, runId])

  React.useEffect(() => {
    if (!changeSet || changeSet.changes.length === 0) {
      setSelectedChangeId(null)
      return
    }

    const hasSelected = selectedChangeId
      ? changeSet.changes.some((change) => change.id === selectedChangeId)
      : false
    if (hasSelected) return

    const preferred =
      changeSet.changes.find(
        (change) => change.status === 'open' || change.status === 'conflicted'
      ) ?? changeSet.changes[0]
    setSelectedChangeId(preferred?.id ?? null)
  }, [changeSet, selectedChangeId])

  const selectedChange =
    changeSet?.changes.find((change) => change.id === selectedChangeId) ??
    changeSet?.changes[0] ??
    null

  const summary = React.useMemo(
    () =>
      (changeSet?.changes ?? []).reduce(
        (acc, change) => {
          const next = summarizeTrackedChange(change)
          acc.added += next.added
          acc.deleted += next.deleted
          return acc
        },
        { added: 0, deleted: 0 }
      ),
    [changeSet]
  )

  const pendingCount = React.useMemo(
    () =>
      (changeSet?.changes ?? []).filter(
        (change) => change.status === 'open' || change.status === 'conflicted'
      ).length,
    [changeSet]
  )
  const actionable = pendingCount > 0

  const handleAcceptAll = async (): Promise<void> => {
    setIsAcceptingAll(true)
    try {
      await acceptRunChanges(runId)
    } finally {
      setIsAcceptingAll(false)
    }
  }

  const handleRollbackAll = async (): Promise<void> => {
    setIsRollingBackAll(true)
    try {
      await rollbackRunChanges(runId)
    } finally {
      setIsRollingBackAll(false)
    }
  }

  if (isRefreshing && !changeSet) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-400">
        <Loader2 className="mr-2 size-4 animate-spin text-emerald-400" />
        {t('thinking.thinkingEllipsis')}
      </div>
    )
  }

  if (!changeSet) {
    return <EmptyState />
  }

  return (
    <div className="flex h-full min-h-0 flex-col text-zinc-100">
      <div className="px-4 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-zinc-400">
                {t('fileChange.filesChanged', { count: changeSet.changes.length })}
              </span>
              <span className="text-sm font-medium text-emerald-300">+{summary.added}</span>
              <span className="text-sm font-medium text-red-300">-{summary.deleted}</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-zinc-500">
              {t('fileChange.reviewPanelDescription', {
                defaultValue:
                  'Review changed files for this run on the right and confirm or undo them individually.'
              })}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="text-zinc-200 hover:bg-white/[0.04]"
              onClick={() => void handleAcceptAll()}
              disabled={!actionable || isAcceptingAll || isRollingBackAll}
            >
              {isAcceptingAll ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Check className="size-3" />
              )}
              {t('action.allow', { ns: 'common' })}
            </Button>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="text-zinc-200 hover:bg-white/[0.04]"
              onClick={() => void handleRollbackAll()}
              disabled={!actionable || isAcceptingAll || isRollingBackAll}
            >
              {isRollingBackAll ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <RotateCcw className="size-3" />
              )}
              {t('action.undo', { ns: 'common' })}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)]">
        <aside className="min-h-0 border-r border-white/[0.06]">
          <div className="px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
              {t('fileChange.reviewFileList', { defaultValue: 'Files' })}
            </p>
          </div>
          <div className="overflow-y-auto">
            {changeSet.changes.map((change) => (
              <ChangeRow
                key={change.id}
                change={change}
                selected={change.id === selectedChange?.id}
                onSelect={() => setSelectedChangeId(change.id)}
              />
            ))}
          </div>
        </aside>

        <section className="min-h-0 bg-[#0f1012]">
          {!selectedChange ? (
            <div className="p-5">
              <EmptyState />
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col">
              <div className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <ActionLabel change={selectedChange} />
                      <span className={cn('text-[11px]', statusTone(selectedChange))}>
                        {t(statusLabelKey(selectedChange))}
                      </span>
                      <span className={cn('text-[11px]', transportTone(selectedChange))}>
                        {t(`fileChange.transport.${selectedChange.transport}`)}
                      </span>
                    </div>
                    <h3 className="mt-3 truncate text-lg font-semibold text-sky-300">
                      {fileName(selectedChange.filePath)}
                    </h3>
                    <div
                      className="mt-1 max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-zinc-500"
                      title={selectedChange.filePath}
                      style={{ fontFamily: MONO_FONT }}
                    >
                      {selectedChange.filePath}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-emerald-300">
                      +{summarizeTrackedChange(selectedChange).added}
                    </span>
                    <span className="text-sm font-medium text-red-300">
                      -{summarizeTrackedChange(selectedChange).deleted}
                    </span>
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <ChangeDetail change={selectedChange} />
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

export function ChangeReviewSheet({
  open,
  onOpenChange,
  changeSet,
  initialChangeId = null
}: ChangeReviewSheetProps): React.JSX.Element {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-[min(1100px,calc(100vw-24px))] max-w-none gap-0 border-l border-white/10 bg-[#0d0e10]/98 p-0 text-zinc-100 shadow-[-24px_0_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl sm:max-w-[1100px]"
      >
        <ChangeReviewPanelContent
          runId={changeSet.runId}
          initialChangeId={initialChangeId}
          changeSetOverride={changeSet}
        />
      </SheetContent>
    </Sheet>
  )
}
