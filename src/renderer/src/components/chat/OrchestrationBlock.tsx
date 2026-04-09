import { useMemo } from 'react'
import { ArrowUpRight, Bot, Users } from 'lucide-react'
import type { OrchestrationRun } from '@renderer/lib/orchestration/types'
import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import { OrchestrationStagePills } from './OrchestrationStagePills'
import { OrchestrationMemberStrip } from './OrchestrationMemberStrip'

function getStatusLabel(status: OrchestrationRun['status']): string {
  if (status === 'running') return '进行中'
  if (status === 'failed') return '失败'
  return '已完成'
}

export function OrchestrationBlock({ run }: { run: OrchestrationRun }): React.JSX.Element {
  const openOrchestrationMember = useUIStore((s) => s.openOrchestrationMember)

  const stats = useMemo(() => {
    const total = run.members.length
    const completed = run.members.filter((member) => !member.isRunning && member.status !== 'failed').length
    const failed = run.members.filter((member) => member.status === 'failed').length
    const working = run.members.filter((member) => member.isRunning).length
    return { total, completed, failed, working }
  }, [run.members])

  return (
    <div className="my-3 overflow-hidden rounded-2xl border border-border/60 bg-background/75 shadow-sm">
      <div className="border-b border-border/60 px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-9 items-center justify-center rounded-xl border border-border/60 bg-muted/25 text-foreground/85">
            {run.kind === 'team' ? <Users className="size-4" /> : <Bot className="size-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-foreground/92">{run.title}</h3>
              <span
                className={cn(
                  'inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium',
                  run.status === 'running' && 'border-cyan-500/30 bg-cyan-500/12 text-cyan-300',
                  run.status === 'completed' && 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400',
                  run.status === 'failed' && 'border-destructive/30 bg-destructive/10 text-destructive'
                )}
              >
                {getStatusLabel(run.status)}
              </span>
              <span className="text-[10px] text-muted-foreground/65">
                阶段 {run.stageIndex + 1}/{run.stageCount}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-xs text-muted-foreground/75">
              {run.summary || run.latestAction}
            </p>
          </div>
          <button
            type="button"
            onClick={() => openOrchestrationMember(run.id, run.selectedMemberId ?? run.members[0]?.id ?? null)}
            className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <span>查看详情</span>
            <ArrowUpRight className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="space-y-3 px-4 py-3">
        <OrchestrationStagePills stages={run.stages} compact />

        <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground/70">
          <span className="rounded-full border border-border/60 bg-background/70 px-2.5 py-1">
            {run.kind === 'team' ? `成员 ${stats.total}` : '单代理执行'}
          </span>
          <span className="rounded-full border border-border/60 bg-background/70 px-2.5 py-1">
            完成 {stats.completed}
          </span>
          {stats.working > 0 && (
            <span className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2.5 py-1 text-cyan-300">
              运行中 {stats.working}
            </span>
          )}
          {stats.failed > 0 && (
            <span className="rounded-full border border-destructive/25 bg-destructive/10 px-2.5 py-1 text-destructive">
              失败 {stats.failed}
            </span>
          )}
        </div>

        <OrchestrationMemberStrip members={run.members} />
      </div>
    </div>
  )
}
