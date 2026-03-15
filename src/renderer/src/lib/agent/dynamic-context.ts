import { useUIStore } from '../../stores/ui-store'
import { useChatStore } from '../../stores/chat-store'

/**
 * Build dynamic context for the first user message in a session.
 * Includes current task list status and selected files (if any).
 * 
 * @param options - Configuration options
 * @returns A <system-reminder> block with context, or empty string if no context
 */
export function buildDynamicContext(options: {
  sessionId: string
}): string {
  const { sessionId } = options

  const contextParts: string[] = []
  // ── Selected Files ──
  const selectedFiles = useUIStore.getState().selectedFiles ?? []
  const session = useChatStore.getState().sessions.find(s => s.id === sessionId)
  const workingFolder = session?.workingFolder

  if (selectedFiles.length > 0) {
    contextParts.push(`- Selected Files: ${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''}`)

    // Convert to relative paths if possible
    for (const filePath of selectedFiles) {
      let displayPath = filePath
      if (workingFolder && filePath.startsWith(workingFolder)) {
        displayPath = filePath.slice(workingFolder.length).replace(/^[\\/]/, '')
      }
      contextParts.push(`  - ${displayPath}`)
    }
  }

  // ── Build final context ──
  const contextContent = contextParts.join('\n')

  // Only generate system-reminder if there's actual content
  if (!contextContent) {
    return ''
  }

  const parts: string[] = []
  parts.push('Current Context:')
  parts.push(contextContent)

  return `<system-reminder>\n${parts.join('\n')}\n</system-reminder>`
}
