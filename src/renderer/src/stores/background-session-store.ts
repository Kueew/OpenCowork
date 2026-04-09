import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { nanoid } from 'nanoid'
import type { UnifiedMessage } from '@renderer/lib/api/types'

export type PendingInboxItemType =
  | 'ask_user'
  | 'approval'
  | 'preview_ready'
  | 'desktop_control'
  | 'foreground_bash'
  | 'error'

export interface PendingInboxPreviewTarget {
  kind: 'file'
  filePath: string
  viewMode: 'preview' | 'code'
  sshConnectionId?: string
}

export interface PendingInboxItem {
  id: string
  sessionId: string
  type: PendingInboxItemType
  title: string
  description?: string
  toolUseId?: string
  createdAt: number
  resolvedAt?: number
  target?: PendingInboxPreviewTarget
}

export interface BackgroundBufferedSessionState {
  patchedMessagesById: Record<string, UnifiedMessage>
  addedMessages: UnifiedMessage[]
  unreadCount: number
  lastEventAt: number | null
}

interface BackgroundSessionStore {
  sessions: Record<string, BackgroundBufferedSessionState>
  inboxItems: PendingInboxItem[]
  unreadCountsBySession: Record<string, number>
  blockedCountsBySession: Record<string, number>
  ensureSessionState: (sessionId: string) => void
  upsertPatchedMessage: (sessionId: string, message: UnifiedMessage) => void
  upsertAddedMessage: (sessionId: string, message: UnifiedMessage) => void
  markSessionUpdate: (sessionId: string) => void
  clearBufferedSession: (sessionId: string) => void
  addInboxItem: (item: Omit<PendingInboxItem, 'id' | 'createdAt'> & { id?: string }) => string
  resolveInboxItem: (itemId: string) => void
  resolveInboxItemByToolUseId: (toolUseId: string) => void
  clearSession: (sessionId: string) => void
}

function createEmptySessionState(): BackgroundBufferedSessionState {
  return {
    patchedMessagesById: {},
    addedMessages: [],
    unreadCount: 0,
    lastEventAt: null
  }
}

function rebuildBlockedCounts(items: PendingInboxItem[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items) {
    if (item.resolvedAt) continue
    if (item.type === 'error') continue
    counts[item.sessionId] = (counts[item.sessionId] ?? 0) + 1
  }
  return counts
}

function isSamePreviewTarget(
  left?: PendingInboxPreviewTarget,
  right?: PendingInboxPreviewTarget
): boolean {
  if (!left && !right) return true
  if (!left || !right) return false
  return (
    left.kind === right.kind &&
    left.filePath === right.filePath &&
    left.viewMode === right.viewMode &&
    left.sshConnectionId === right.sshConnectionId
  )
}

function cloneMessage(message: UnifiedMessage): UnifiedMessage {
  try {
    return JSON.parse(JSON.stringify(message)) as UnifiedMessage
  } catch {
    return {
      ...message,
      content: Array.isArray(message.content)
        ? (JSON.parse(JSON.stringify(message.content)) as UnifiedMessage['content'])
        : message.content,
      ...(message.usage ? { usage: JSON.parse(JSON.stringify(message.usage)) } : {})
    }
  }
}

export const useBackgroundSessionStore = create<BackgroundSessionStore>()(
  immer((set, get) => ({
    sessions: {},
    inboxItems: [],
    unreadCountsBySession: {},
    blockedCountsBySession: {},

    ensureSessionState: (sessionId) => {
      set((state) => {
        state.sessions[sessionId] ??= createEmptySessionState()
      })
    },

    upsertPatchedMessage: (sessionId, message) => {
      set((state) => {
        const session =
          state.sessions[sessionId] ?? (state.sessions[sessionId] = createEmptySessionState())
        session.patchedMessagesById[message.id] = cloneMessage(message)
      })
    },

    upsertAddedMessage: (sessionId, message) => {
      set((state) => {
        const session =
          state.sessions[sessionId] ?? (state.sessions[sessionId] = createEmptySessionState())
        const existingIndex = session.addedMessages.findIndex((item) => item.id === message.id)
        const cloned = cloneMessage(message)
        if (existingIndex >= 0) {
          session.addedMessages[existingIndex] = cloned
        } else {
          session.addedMessages.push(cloned)
        }
      })
    },

    markSessionUpdate: (sessionId) => {
      set((state) => {
        const session =
          state.sessions[sessionId] ?? (state.sessions[sessionId] = createEmptySessionState())
        const nextUnread = session.unreadCount + 1
        session.unreadCount = nextUnread
        session.lastEventAt = Date.now()
        state.unreadCountsBySession[sessionId] = nextUnread
      })
    },

    clearBufferedSession: (sessionId) => {
      set((state) => {
        if (!state.sessions[sessionId]) return
        delete state.sessions[sessionId]
        delete state.unreadCountsBySession[sessionId]
      })
    },

    addInboxItem: (item) => {
      const toolUseId = item.toolUseId?.trim() || undefined
      const sessionId = item.sessionId
      const type = item.type
      const title = item.title.trim()

      if (!sessionId || !title) return ''

      const existing = get().inboxItems.find(
        (candidate) =>
          !candidate.resolvedAt &&
          candidate.sessionId === sessionId &&
          candidate.type === type &&
          ((toolUseId && candidate.toolUseId === toolUseId) ||
            (!toolUseId &&
              candidate.title === title &&
              candidate.description === item.description &&
              isSamePreviewTarget(candidate.target, item.target)))
      )
      if (existing) return existing.id

      const nextId = item.id?.trim() || nanoid()
      set((state) => {
        state.inboxItems.unshift({
          id: nextId,
          sessionId,
          type,
          title,
          ...(item.description ? { description: item.description } : {}),
          ...(toolUseId ? { toolUseId } : {}),
          ...(item.target ? { target: item.target } : {}),
          createdAt: Date.now()
        })
        state.blockedCountsBySession = rebuildBlockedCounts(state.inboxItems)
      })
      return nextId
    },

    resolveInboxItem: (itemId) => {
      if (!itemId) return
      set((state) => {
        const item = state.inboxItems.find((candidate) => candidate.id === itemId)
        if (!item || item.resolvedAt) return
        item.resolvedAt = Date.now()
        state.blockedCountsBySession = rebuildBlockedCounts(state.inboxItems)
      })
    },

    resolveInboxItemByToolUseId: (toolUseId) => {
      if (!toolUseId) return
      set((state) => {
        let changed = false
        for (const item of state.inboxItems) {
          if (item.toolUseId !== toolUseId || item.resolvedAt) continue
          item.resolvedAt = Date.now()
          changed = true
        }
        if (changed) {
          state.blockedCountsBySession = rebuildBlockedCounts(state.inboxItems)
        }
      })
    },

    clearSession: (sessionId) => {
      set((state) => {
        delete state.sessions[sessionId]
        delete state.unreadCountsBySession[sessionId]
        state.inboxItems = state.inboxItems.filter((item) => item.sessionId !== sessionId)
        state.blockedCountsBySession = rebuildBlockedCounts(state.inboxItems)
      })
    }
  }))
)
