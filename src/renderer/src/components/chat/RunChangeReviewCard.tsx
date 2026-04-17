import * as React from 'react'
import { Check, CheckCircle2, ChevronRight, Loader2, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import type { AgentRunChangeSet } from '@renderer/stores/agent-store'
import { useAgentStore } from '@renderer/stores/agent-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { fileName, summarizeTrackedChange } from './file-change-utils'

interface RunChangeReviewCardProps {
  runId: string
  changeSet: AgentRunChangeSet
}

function runStatusLabelKey(changeSet: AgentRunChangeSet): string {
  return changeSet.status === 'accepted'
    ? 'fileChange.runStatus.accepted'
    : changeSet.status === 'reverted'
      ? 'fileChange.runStatus.reverted'
      : changeSet.status === 'conflicted'
        ? 'fileChange.runStatus.conflicted'
        : changeSet.status === 'partial'
          ? 'fileChange.runStatus.partial'
          : 'fileChange.runStatus.review'
}

function runStatusTone(changeSet: AgentRunChangeSet): string {
  return changeSet.status === 'accepted'
    ? 'text-emerald-300'
    : changeSet.status === 'reverted'
      ? 'text-zinc-300'
      : changeSet.status === 'conflicted'
        ? 'text-amber-300'
        : 'text-sky-300'
}

function rowActionTone(): string {
  return 'text-zinc-400'
}

export function RunChangeReviewCard({
  runId,
  changeSet
}: RunChangeReviewCardProps): React.JSX.Element {
  const { t } = useTranslation(['chat', 'common'])
  const acceptRunChanges = useAgentStore((state) => state.acceptRunChanges)
  const rollbackRunChanges = useAgentStore((state) => state.rollbackRunChanges)
  const openDetailPanel = useUIStore((state) => state.openDetailPanel)
  const [isAccepting, setIsAccepting] = React.useState(false)
  const [isRollingBack, setIsRollingBack] = React.useState(false)

  const summary = React.useMemo(
    () =>
      changeSet.changes.reduce(
        (acc, change) => {
          const stats = summarizeTrackedChange(change)
          acc.added += stats.added
          acc.deleted += stats.deleted
          return acc
        },
        { added: 0, deleted: 0 }
      ),
    [changeSet]
  )

  const pendingCount = React.useMemo(
    () =>
      changeSet.changes.filter(
        (change) => change.status === 'open' || change.status === 'conflicted'
      ).length,
    [changeSet]
  )
  const actionable = pendingCount > 0
  const visibleChanges = changeSet.changes.slice(0, 3)

  const handleAccept = async (): Promise<void> => {
    setIsAccepting(true)
    try {
      await acceptRunChanges(runId)
    } finally {
      setIsAccepting(false)
    }
  }

  const handleRollback = async (): Promise<void> => {
    setIsRollingBack(true)
    try {
      await rollbackRunChanges(runId)
    } finally {
      setIsRollingBack(false)
    }
  }

  const handleOpenReview = (nextChangeId: string | null): void => {
    openDetailPanel({
      type: 'change-review',
      runId,
      initialChangeId: nextChangeId
    })
  }

  return (
    <div className="mt-4 text-zinc-100">
      <div className="px-4 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CheckCircle2 className="size-4 text-emerald-400" />
              <span className={cn('text-[11px] font-medium', runStatusTone(changeSet))}>
                {t(runStatusLabelKey(changeSet))}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <h3 className="text-base font-semibold text-zinc-50">
                {t('fileChange.filesChanged', { count: changeSet.changes.length })}
              </h3>
              <span className="text-sm font-medium text-emerald-300">+{summary.added}</span>
              <span className="text-sm font-medium text-red-300">-{summary.deleted}</span>
            </div>

            <p className="mt-2 text-xs leading-5 text-zinc-500">
              {t('fileChange.runSummary', {
                files: changeSet.changes.length,
                pending: pendingCount
              })}
            </p>

            {changeSet.status === 'conflicted' ? (
              <p className="mt-2 text-xs leading-5 text-amber-300/90">
                {t('fileChange.conflictedHint')}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="text-zinc-200 hover:bg-white/[0.04]"
              onClick={() => handleOpenReview(changeSet.changes[0]?.id ?? null)}
            >
              {t('fileChange.openReview', { defaultValue: '查看更改' })}
              <ChevronRight className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="text-zinc-200 hover:bg-white/[0.04]"
              onClick={() => void handleAccept()}
              disabled={!actionable || isAccepting || isRollingBack}
            >
              {isAccepting ? (
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
              onClick={() => void handleRollback()}
              disabled={!actionable || isAccepting || isRollingBack}
            >
              {isRollingBack ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <RotateCcw className="size-3" />
              )}
              {t('action.undo', { ns: 'common' })}
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-1">
        <div>
          {visibleChanges.map((change) => {
            const stats = summarizeTrackedChange(change)
            return (
              <button
                key={change.id}
                type="button"
                onClick={() => handleOpenReview(change.id)}
                className="group w-full px-2 py-0.5 text-left"
              >
                <div
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 text-zinc-400 transition-colors group-hover:bg-white/[0.015] group-hover:text-zinc-100"
                  title={change.filePath}
                >
                  <span className={cn('shrink-0 text-[10px] font-medium', rowActionTone())}>
                    {change.op === 'create' ? t('fileChange.new') : t('fileChange.edited')}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-sky-300 transition-colors group-hover:text-sky-200">
                    {fileName(change.filePath)}
                  </span>
                  <div className="flex shrink-0 items-center gap-1.5 text-[10px] font-medium">
                    <span className="text-emerald-300">+{stats.added}</span>
                    <span className="text-red-300">-{stats.deleted}</span>
                  </div>
                  <ChevronRight className="size-3 shrink-0 text-zinc-600" />
                </div>
              </button>
            )
          })}

          {changeSet.changes.length > visibleChanges.length ? (
            <button
              type="button"
              onClick={() => handleOpenReview(changeSet.changes[visibleChanges.length]?.id ?? null)}
              className="group w-full px-2 py-0.5 text-left"
            >
              <div className="flex items-center justify-center rounded-md px-2 py-2 text-xs text-zinc-500 transition-colors group-hover:bg-white/[0.015] group-hover:text-zinc-200">
                {t('fileChange.moreFiles', {
                  count: changeSet.changes.length - visibleChanges.length
                })}
              </div>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
