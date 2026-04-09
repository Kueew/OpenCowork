import type { OrchestrationMember } from '@renderer/lib/orchestration/types'
import { cn } from '@renderer/lib/utils'

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function OrchestrationMemberStrip({
  members
}: {
  members: OrchestrationMember[]
}): React.JSX.Element {
  return (
    <div className="space-y-2">
      {members.slice(0, 6).map((member, index) => (
        <div key={member.id} className="rounded-xl border border-border/60 bg-background/65 px-3 py-2">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-full border border-border/60 bg-muted/30 text-[11px] font-semibold text-foreground/85">
              {String(index + 1).padStart(2, '0')}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground/92">{member.name}</span>
                <span
                  className={cn(
                    'inline-flex rounded-full border px-1.5 py-0.5 text-[9px] font-medium',
                    member.status === 'working' && 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
                    member.status === 'completed' && 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400',
                    member.status === 'failed' && 'border-destructive/30 bg-destructive/10 text-destructive',
                    member.status !== 'working' &&
                      member.status !== 'completed' &&
                      member.status !== 'failed' &&
                      'border-border/60 bg-background/70 text-muted-foreground/70'
                  )}
                >
                  {member.status}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">
                {member.latestAction || member.summary || '等待执行'}
              </p>
            </div>
            <div className="text-right text-[10px] text-muted-foreground/65">
              <div>{formatPercent(member.progress)}</div>
              <div>{member.toolCallCount} calls</div>
            </div>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted/40">
            <div
              className={cn(
                'h-full rounded-full transition-[width]',
                member.status === 'failed' ? 'bg-destructive/70' : 'bg-cyan-400'
              )}
              style={{ width: formatPercent(member.progress) }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
