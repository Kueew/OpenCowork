import * as React from 'react'
import { useEffect } from 'react'
import {
  CircleHelp,
  Briefcase,
  Code2,
  ShieldCheck,
  BookOpen,
  FolderOpen,
  PanelLeftOpen
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import { InputArea } from '@renderer/components/chat/InputArea'
import { useUIStore } from '@renderer/stores/ui-store'
import { useChatStore } from '@renderer/stores/chat-store'
import { useProviderStore, modelSupportsVision } from '@renderer/stores/provider-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { useChatActions, type SendMessageOptions } from '@renderer/hooks/use-chat-actions'
import appIconUrl from '../../../../../resources/icon.png'
import type { ImageAttachment } from '@renderer/lib/image-attachments'
import { WorkingFolderSelectorDialog } from './WorkingFolderSelectorDialog'
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

function formatContextLength(length?: number): string | null {
  if (!length) return null
  if (length >= 1_000_000) {
    return `${(length / 1_000_000).toFixed(length % 1_000_000 === 0 ? 0 : 1)}M`
  }
  if (length >= 1_000) return `${Math.round(length / 1_000)}K`
  return String(length)
}

export function ChatHomePage(): React.JSX.Element {
  const { t } = useTranslation('chat')
  const { t: tCommon } = useTranslation('common')
  const { t: tLayout } = useTranslation('layout')
  const mode = useUIStore((s) => s.mode)
  const setMode = useUIStore((s) => s.setMode)
  const leftSidebarOpen = useUIStore((s) => s.leftSidebarOpen)
  const toggleLeftSidebar = useUIStore((s) => s.toggleLeftSidebar)
  const activeProjectId = useChatStore((s) => s.activeProjectId)
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const projects = useChatStore((s) => s.projects)
  const sessions = useChatStore((s) => s.sessions)
  const activeProject =
    projects.find((project) => project.id === activeProjectId) ??
    projects.find((project) => !project.pluginId) ??
    projects[0]
  const workingFolder = activeProject?.workingFolder
  const sshConnectionId = activeProject?.sshConnectionId
  const { sendMessage } = useChatActions()
  const [folderDialogOpen, setFolderDialogOpen] = React.useState(false)
  const activeProviderId = useProviderStore((s) => s.activeProviderId)
  const activeModelId = useProviderStore((s) => s.activeModelId)
  const providers = useProviderStore((s) => s.providers)
  const mainModelSelectionMode = useSettingsStore((s) => s.mainModelSelectionMode)
  const conversationGuideSeen = useSettingsStore((s) => s.conversationGuideSeen)
  const autoModelSelectionsBySession = useUIStore((s) => s.autoModelSelectionsBySession)
  const autoSelection = activeSessionId
    ? (autoModelSelectionsBySession[activeSessionId] ?? null)
    : null

  const handleSend = (
    text: string,
    images?: ImageAttachment[],
    options?: SendMessageOptions
  ): void => {
    const chatStore = useChatStore.getState()
    const sessionId = chatStore.createSession(mode, activeProject?.id ?? undefined, options)
    chatStore.setActiveSession(sessionId)
    useUIStore.getState().navigateToSession()
    void sendMessage(text, images, undefined, sessionId, undefined, undefined, {
      ...options,
      clearCompletedTasksOnTurnStart: true
    })
  }

  const updateHomeProjectDirectory = React.useCallback(
    async (patch: { workingFolder: string; sshConnectionId: string | null }): Promise<void> => {
      const chatStore = useChatStore.getState()
      let projectId: string | null = activeProject?.id ?? activeProjectId ?? null
      if (!projectId) {
        const ensured = await chatStore.ensureDefaultProject()
        projectId = ensured?.id ?? null
      }
      if (!projectId) return
      chatStore.setActiveProject(projectId)
      chatStore.updateProjectDirectory(projectId, patch)
    },
    [activeProject?.id, activeProjectId]
  )

  const handleOpenFolderDialog = React.useCallback((): void => {
    setFolderDialogOpen(true)
  }, [])

  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const sessionProviderId = activeSession?.providerId ?? null
  const sessionModelId = activeSession?.modelId ?? null
  const isSessionBound = Boolean(sessionProviderId && sessionModelId)
  const displayProviderId = sessionProviderId ?? activeProviderId
  const displayModelId = sessionModelId ?? activeModelId
  const displayProvider = providers.find((provider) => provider.id === displayProviderId)
  const displayModel = displayProvider?.models.find((model) => model.id === displayModelId)
  const isAutoModeActive = !isSessionBound && mainModelSelectionMode === 'auto'
  const autoResolvedProvider = autoSelection?.providerId
    ? providers.find((provider) => provider.id === autoSelection.providerId)
    : null
  const autoResolvedModel = autoResolvedProvider?.models.find(
    (model) => model.id === autoSelection?.modelId
  )
  const homeProvider = isAutoModeActive
    ? (autoResolvedProvider ?? displayProvider)
    : displayProvider
  const homeModel = isAutoModeActive ? (autoResolvedModel ?? displayModel) : displayModel
  const homeHasVision = modelSupportsVision(homeModel, homeProvider?.type)
  const homeHasTools = homeModel?.supportsFunctionCall === true
  const homeHasThinking = homeModel?.supportsThinking === true
  const homeModelTitle = isAutoModeActive
    ? autoSelection?.modelName
      ? `${tLayout('topbar.autoModel')} · ${autoSelection.modelName}`
      : tLayout('topbar.autoModel')
    : (homeModel?.name ?? displayModelId ?? t('messageList.homeModelUnavailable'))
  const homeTitle = {
    chat: t('messageList.homeTitleChat'),
    clarify: t('messageList.homeTitleClarify'),
    cowork: t('messageList.homeTitleCowork'),
    code: t('messageList.homeTitleCode'),
    acp: t('messageList.homeTitleAcp')
  }[mode]

  let homeDescription = t('messageList.homeDescChatGeneral')
  if (isAutoModeActive) {
    homeDescription = {
      chat: t('messageList.homeDescAutoChat'),
      clarify: t('messageList.homeDescAutoClarify'),
      cowork: t('messageList.homeDescAutoCowork'),
      code: t('messageList.homeDescAutoCode'),
      acp: t('messageList.homeDescAutoAcp')
    }[mode]
  } else if (mode === 'clarify') {
    homeDescription = homeHasThinking
      ? t('messageList.homeDescClarifyThinking')
      : t('messageList.homeDescClarifyGeneral')
  } else if (mode === 'cowork') {
    homeDescription = homeHasTools
      ? t('messageList.homeDescCoworkTools')
      : t('messageList.homeDescCoworkGeneral')
  } else if (mode === 'code') {
    homeDescription = homeHasThinking
      ? t('messageList.homeDescCodeThinking')
      : homeHasVision
        ? t('messageList.homeDescCodeVision')
        : t('messageList.homeDescCodeGeneral')
  } else if (mode === 'acp') {
    homeDescription = t('messageList.homeDescAcp')
  } else {
    homeDescription = homeHasVision
      ? t('messageList.homeDescChatVision')
      : t('messageList.homeDescChatGeneral')
  }

  const homeModelMetaParts = [
    homeProvider?.name,
    homeHasVision ? tLayout('topbar.vision') : null,
    homeHasTools ? tLayout('topbar.tools') : null,
    homeHasThinking ? tLayout('topbar.thinking') : null,
    formatContextLength(homeModel?.contextLength)
  ].filter((value): value is string => Boolean(value))
  const homeModelMeta =
    homeModelMetaParts.join(' · ') || (isAutoModeActive ? t('messageList.homeAutoMeta') : '')

  useEffect(() => {
    if (conversationGuideSeen) return
    if (sessions.length > 0) return
    const timer = window.setTimeout(() => {
      useUIStore.getState().setConversationGuideOpen(true)
    }, 240)
    return () => window.clearTimeout(timer)
  }, [conversationGuideSeen, sessions.length])

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
          <div
            data-tour="mode-switch"
            className="flex items-center gap-0.5 rounded-xl border border-border/50 bg-background/95 p-0.5 shadow-sm"
          >
            {modes.map((m, i) => (
              <Tooltip key={m.value}>
                <TooltipTrigger asChild>
                  <Button
                    data-tour={`mode-${m.value}`}
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'relative h-8 gap-1.5 overflow-hidden rounded-lg px-3 text-xs font-medium transition-colors duration-200',
                      mode === m.value
                        ? cn(MODE_SWITCH_ACTIVE_TEXT_CLASS[m.value], 'font-semibold')
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                    onClick={() => setMode(m.value)}
                  >
                    <AnimatePresence initial={false}>
                      {mode === m.value && (
                        <motion.span
                          layoutId="home-mode-switch-highlight"
                          className={cn(
                            'pointer-events-none absolute inset-0 rounded-lg border',
                            MODE_SWITCH_HIGHLIGHT_CLASS[m.value]
                          )}
                          transition={MODE_SWITCH_TRANSITION}
                        />
                      )}
                    </AnimatePresence>
                    <span className="relative z-10 flex items-center gap-1.5">
                      {m.icon}
                      {tCommon(m.labelKey)}
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
                    mode: m.value,
                    labelKey: m.labelKey,
                    icon: m.icon,
                    shortcutIndex: i,
                    isActive: mode === m.value,
                    t: (key, options) => String(tLayout(key, options as never)),
                    tCommon: (key, options) => String(tCommon(key, options as never))
                  })}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>

          {activeProject ? (
            <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-border/60 bg-muted/20 px-3 py-1.5 text-[11px] text-muted-foreground">
              <span>{t('messageList.homeWorkspaceCaption')}</span>
              <span className="truncate text-foreground">{activeProject.name}</span>
            </div>
          ) : null}
        </div>

        <div className="mt-4 border-b border-border/50 pb-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
                {t('messageList.homeWorkspaceCaption')}
              </p>
              <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-foreground sm:text-[30px]">
                {homeTitle}
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                {homeDescription}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full border border-border/60 bg-background px-2.5 py-1 text-[11px] text-muted-foreground">
                  {t('messageList.homeCurrentModel', { model: homeModelTitle })}
                </span>
                {homeModelMeta ? (
                  <span className="rounded-full border border-border/60 bg-muted/20 px-2.5 py-1 text-[11px] text-muted-foreground">
                    {homeModelMeta}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="hidden rounded-xl border border-border/60 bg-muted/20 p-3 lg:block">
              <div className="flex items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-xl border border-border/60 bg-background">
                  <img
                    src={appIconUrl}
                    alt="OpenCowork"
                    className="size-7 rounded-lg object-cover ring-1 ring-border/50"
                  />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
                    {t('messageList.homeWorkspaceCaption')}
                  </div>
                  <div className="truncate text-sm font-medium text-foreground">
                    {activeProject?.name ?? t('projectHome.noProjectSelected')}
                  </div>
                </div>
              </div>
              <div className="mt-3 space-y-2 text-[11px] text-muted-foreground">
                <div className="flex items-start gap-2">
                  <FolderOpen className="mt-0.5 size-3.5 shrink-0" />
                  <span className="line-clamp-2 break-all">
                    {workingFolder ?? t('projectHome.noWorkingFolder')}
                  </span>
                </div>
                {sshConnectionId ? (
                  <div className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-2 py-1 text-[10px] text-foreground/80">
                    <span>SSH</span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <InputArea
            sessionId={null}
            onSend={handleSend}
            onSelectFolder={mode !== 'chat' ? handleOpenFolderDialog : undefined}
            workingFolder={workingFolder}
            hideWorkingFolderIndicator
            isStreaming={false}
          />
        </div>

        {mode !== 'chat' && (
          <WorkingFolderSelectorDialog
            open={folderDialogOpen}
            onOpenChange={setFolderDialogOpen}
            workingFolder={workingFolder}
            sshConnectionId={sshConnectionId}
            onSelectLocalFolder={(folderPath) =>
              updateHomeProjectDirectory({
                workingFolder: folderPath,
                sshConnectionId: null
              })
            }
            onSelectSshFolder={(folderPath, connectionId) =>
              updateHomeProjectDirectory({
                workingFolder: folderPath,
                sshConnectionId: connectionId
              })
            }
          />
        )}

        <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
          <div className="flex items-start justify-between gap-3 rounded-xl border border-border/60 bg-primary/5 px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <BookOpen className="size-4 text-primary" />
                <span>{t('guide.bannerTitle')}</span>
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {t('guide.bannerDesc')}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 shrink-0"
              onClick={() => useUIStore.getState().setConversationGuideOpen(true)}
            >
              {t('guide.openButton')}
            </Button>
          </div>

          <div className="rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
              <div className="flex items-center gap-2">
                <kbd className="rounded bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  Ctrl+N
                </kbd>
                <span className="text-muted-foreground/70">{t('messageList.newChat')}</span>
              </div>
              <div className="flex items-center gap-2">
                <kbd className="rounded bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  Ctrl+K
                </kbd>
                <span className="text-muted-foreground/70">{t('messageList.commands')}</span>
              </div>
              <div className="flex items-center gap-2">
                <kbd className="rounded bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  Ctrl+B
                </kbd>
                <span className="text-muted-foreground/70">{t('messageList.sidebarShortcut')}</span>
              </div>
              <div className="flex items-center gap-2">
                <kbd className="rounded bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  Ctrl+/
                </kbd>
                <span className="text-muted-foreground/70">
                  {t('messageList.shortcutsShortcut')}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <kbd className="rounded bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  Ctrl+,
                </kbd>
                <span className="text-muted-foreground/70">
                  {t('messageList.settingsShortcut')}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <kbd className="rounded bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  Ctrl+D
                </kbd>
                <span className="text-muted-foreground/70">
                  {t('messageList.duplicateShortcut')}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
