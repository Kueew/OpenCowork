import * as React from 'react'
import {
  CircleHelp,
  Briefcase,
  Code2,
  ShieldCheck,
  FolderOpen,
  BookOpen,
  MessageSquare,
  GitBranch,
  PanelLeftOpen
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import { InputArea } from '@renderer/components/chat/InputArea'
import { WorkingFolderSelectorDialog } from '@renderer/components/chat/WorkingFolderSelectorDialog'
import { useUIStore } from '@renderer/stores/ui-store'
import { useChatStore } from '@renderer/stores/chat-store'
import { useChatActions, type SendMessageOptions } from '@renderer/hooks/use-chat-actions'
import type { ImageAttachment } from '@renderer/lib/image-attachments'
import {
  renderModeTooltipContent,
  type ModeOption,
  type SelectableMode
} from '@renderer/lib/mode-tooltips'
import { AnimatePresence, motion } from 'motion/react'

const modes: ModeOption[] = [
  { value: 'clarify', labelKey: 'mode.clarify', icon: <CircleHelp className="size-3.5" /> },
  { value: 'cowork', labelKey: 'mode.cowork', icon: <Briefcase className="size-3.5" /> },
  { value: 'code', labelKey: 'mode.code', icon: <Code2 className="size-3.5" /> },
  { value: 'acp', labelKey: 'mode.acp', icon: <ShieldCheck className="size-3.5" /> }
]

const MODE_SWITCH_TRANSITION = {
  type: 'spring',
  stiffness: 320,
  damping: 26,
  mass: 0.7
} as const

const MODE_SWITCH_HIGHLIGHT_CLASS: Record<SelectableMode, string> = {
  clarify: 'border-amber-500/15 bg-amber-500/5 shadow-sm',
  cowork: 'border-emerald-500/15 bg-emerald-500/5 shadow-sm',
  code: 'border-violet-500/15 bg-violet-500/5 shadow-sm',
  acp: 'border-cyan-500/15 bg-cyan-500/5 shadow-sm'
}

const MODE_SWITCH_ACTIVE_TEXT_CLASS: Record<SelectableMode, string> = {
  clarify: 'text-foreground',
  cowork: 'text-foreground',
  code: 'text-foreground',
  acp: 'text-foreground'
}

export function ProjectHomePage(): React.JSX.Element {
  const { t } = useTranslation('chat')
  const { t: tCommon } = useTranslation('common')
  const { t: tLayout } = useTranslation('layout')
  const mode = useUIStore((state) => state.mode)
  const setMode = useUIStore((state) => state.setMode)
  const leftSidebarOpen = useUIStore((state) => state.leftSidebarOpen)
  const toggleLeftSidebar = useUIStore((state) => state.toggleLeftSidebar)
  const activeProjectId = useChatStore((state) => state.activeProjectId)
  const projects = useChatStore((state) => state.projects)
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null
  const workingFolder = activeProject?.workingFolder
  const sshConnectionId = activeProject?.sshConnectionId
  const { sendMessage } = useChatActions()
  const [folderDialogOpen, setFolderDialogOpen] = React.useState(false)

  const handleSend = (
    text: string,
    images?: ImageAttachment[],
    options?: SendMessageOptions
  ): void => {
    if (!activeProjectId) return
    const chatStore = useChatStore.getState()
    const sessionId = chatStore.createSession(mode, activeProjectId, options)
    chatStore.setActiveSession(sessionId)
    useUIStore.getState().navigateToSession(sessionId)
    void sendMessage(text, images, undefined, sessionId, undefined, undefined, options)
  }

  const handleOpenFolderDialog = React.useCallback((): void => {
    setFolderDialogOpen(true)
  }, [])

  const updateProjectDirectory = React.useCallback(
    async (patch: { workingFolder: string; sshConnectionId: string | null }): Promise<void> => {
      if (!activeProjectId) return
      useChatStore.getState().updateProjectDirectory(activeProjectId, patch)
    },
    [activeProjectId]
  )

  const renderModeSwitch = (layoutId: string): React.JSX.Element => (
    <div
      data-tour="mode-switch"
      className="flex items-center gap-0.5 rounded-xl border border-border/50 bg-background/95 p-0.5 shadow-sm"
    >
      {modes.map((item, index) => (
        <Tooltip key={item.value}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'relative h-8 gap-1.5 overflow-hidden rounded-lg px-3 text-xs font-medium transition-colors duration-200',
                mode === item.value
                  ? cn(MODE_SWITCH_ACTIVE_TEXT_CLASS[item.value], 'font-semibold')
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setMode(item.value)}
            >
              <AnimatePresence initial={false}>
                {mode === item.value && (
                  <motion.span
                    layoutId={layoutId}
                    className={cn(
                      'pointer-events-none absolute inset-0 rounded-lg border',
                      MODE_SWITCH_HIGHLIGHT_CLASS[item.value]
                    )}
                    transition={MODE_SWITCH_TRANSITION}
                  />
                )}
              </AnimatePresence>
              <span className="relative z-10 flex items-center gap-1.5">
                {item.icon}
                {tCommon(item.labelKey)}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            align="center"
            sideOffset={8}
            className="max-w-[340px] rounded-xl px-3 py-3"
          >
            {renderModeTooltipContent({
              mode: item.value,
              labelKey: item.labelKey,
              icon: item.icon,
              shortcutIndex: index,
              isActive: mode === item.value,
              t: (key, options) => String(tLayout(key, options as never)),
              tCommon: (key, options) => String(tCommon(key, options as never))
            })}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  )

  if (!activeProject) {
    return (
      <div className="relative flex flex-1 flex-col overflow-auto bg-background">
        {!leftSidebarOpen && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute left-4 top-4 z-10 size-8 rounded-lg border border-border/60 bg-background/80 backdrop-blur-sm"
            onClick={toggleLeftSidebar}
          >
            <PanelLeftOpen className="size-4" />
          </Button>
        )}

        <div className="mx-auto flex w-full max-w-[1040px] flex-1 flex-col px-4 pb-6 pt-4 sm:px-6">
          <div className="flex justify-start">{renderModeSwitch('project-empty-mode-switch')}</div>
          <div className="mt-6 max-w-2xl rounded-xl border border-border/60 bg-muted/20 px-5 py-5">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
              {t('projectHome.workspaceLabel')}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
              {t('projectHome.noProjectSelected')}
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {t('projectHome.noProjectSelectedDesc')}
            </p>
            <Button className="mt-4" onClick={() => useUIStore.getState().navigateToHome()}>
              {t('projectHome.backHome')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-auto bg-background">
      {!leftSidebarOpen && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute left-4 top-4 z-10 size-8 rounded-lg border border-border/60 bg-background/80 backdrop-blur-sm"
          onClick={toggleLeftSidebar}
        >
          <PanelLeftOpen className="size-4" />
        </Button>
      )}

      <div className="mx-auto flex w-full max-w-[1040px] flex-1 flex-col px-4 pb-6 pt-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {renderModeSwitch('project-home-mode-switch-highlight')}
          <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-border/60 bg-muted/20 px-3 py-1.5 text-[11px] text-muted-foreground">
            <span>{t('projectHome.workspaceLabel')}</span>
            <span className="truncate text-foreground">{activeProject.name}</span>
          </div>
        </div>

        <div className="mt-4 border-b border-border/50 pb-5">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
                {t('projectHome.workspaceLabel')}
              </p>
              <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-foreground sm:text-[30px]">
                {activeProject.name}
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                {t('projectHome.heroDesc')}
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-border/60 bg-background px-2.5 py-1 text-[11px] text-muted-foreground">
                  <FolderOpen className="size-3.5 shrink-0" />
                  <span className="truncate">
                    {workingFolder ?? t('projectHome.noWorkingFolder')}
                  </span>
                </span>
                {sshConnectionId ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/20 px-2.5 py-1 text-[11px] text-muted-foreground">
                    <span>{t('projectHome.sshLabel')}</span>
                  </span>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <div className="rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
                  {t('projectHome.folderLabel')}
                </div>
                <div className="mt-2 break-all text-sm text-foreground">
                  {workingFolder ?? t('projectHome.noWorkingFolder')}
                </div>
                {sshConnectionId ? (
                  <div className="mt-2 text-[11px] text-muted-foreground">
                    {t('projectHome.sshLabel')}
                  </div>
                ) : null}
              </div>

              <div className="rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
                  {t('projectHome.actionsLabel')}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 rounded-lg px-2.5 text-[12px] text-muted-foreground hover:text-foreground"
                    onClick={() => useUIStore.getState().navigateToArchive(activeProject.id)}
                  >
                    <BookOpen className="size-3.5" />
                    {t('projectHome.openArchive')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 rounded-lg px-2.5 text-[12px] text-muted-foreground hover:text-foreground"
                    onClick={() => useUIStore.getState().navigateToChannels(activeProject.id)}
                  >
                    <MessageSquare className="size-3.5" />
                    {t('projectHome.openChannels')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 rounded-lg px-2.5 text-[12px] text-muted-foreground hover:text-foreground"
                    onClick={() => useUIStore.getState().navigateToGit(activeProject.id)}
                  >
                    <GitBranch className="size-3.5" />
                    {t('projectHome.openGit')}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <InputArea
            sessionId={null}
            onSend={handleSend}
            onSelectFolder={handleOpenFolderDialog}
            workingFolder={workingFolder}
            hideWorkingFolderIndicator
            isStreaming={false}
          />
        </div>

        <WorkingFolderSelectorDialog
          open={folderDialogOpen}
          onOpenChange={setFolderDialogOpen}
          workingFolder={workingFolder}
          sshConnectionId={sshConnectionId}
          onSelectLocalFolder={(folderPath) =>
            updateProjectDirectory({
              workingFolder: folderPath,
              sshConnectionId: null
            })
          }
          onSelectSshFolder={(folderPath, connectionId) =>
            updateProjectDirectory({
              workingFolder: folderPath,
              sshConnectionId: connectionId
            })
          }
        />
      </div>
    </div>
  )
}
