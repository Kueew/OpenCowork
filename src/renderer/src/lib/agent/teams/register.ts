import { toolRegistry } from '../tool-registry'
import { teamEvents } from './events'
import { useTeamStore } from '../../../stores/team-store'
import { useUIStore } from '../../../stores/ui-store'
import { useChatStore } from '../../../stores/chat-store'
import { teamCreateTool } from './tools/team-create'
import { sendMessageTool } from './tools/send-message'
import { teamDeleteTool } from './tools/team-delete'
import { teamStatusTool } from './tools/team-status'
import { getTeamRuntimeSnapshot } from './runtime-client'
import { startTeamInboxPoller } from './inbox-poller'

const TEAM_TOOLS = [teamCreateTool, sendMessageTool, teamStatusTool, teamDeleteTool]

export const TEAM_TOOL_NAMES = new Set(TEAM_TOOLS.map((t) => t.definition.name))

let _teamToolsRegistered = false

export function registerTeamTools(): void {
  if (_teamToolsRegistered) return
  _teamToolsRegistered = true

  for (const tool of TEAM_TOOLS) {
    toolRegistry.register(tool)
  }

  teamEvents.on((event) => {
    const sessionId = event.sessionId ?? useChatStore.getState().activeSessionId ?? undefined
    useTeamStore.getState().handleTeamEvent(event, sessionId)

    if (event.type === 'team_start') {
      const ui = useUIStore.getState()
      ui.setRightPanelOpen(true)
      ui.setRightPanelTab('team')
    }
  })

  const activeTeam = useTeamStore.getState().activeTeam
  if (activeTeam?.name) {
    void getTeamRuntimeSnapshot({ teamName: activeTeam.name, limit: 10 })
      .then((snapshot) => {
        if (!snapshot) return
        useTeamStore.getState().syncRuntimeSnapshot(snapshot, activeTeam.sessionId)
      })
      .catch((error) => {
        console.error('[TeamRuntime] Failed to load active team snapshot:', error)
      })
  }

  const search = new URLSearchParams(window.location.search)
  if (search.get('ocWorker') !== 'team') {
    startTeamInboxPoller()
  }
}
