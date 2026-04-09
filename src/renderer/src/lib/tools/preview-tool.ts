import { toast } from 'sonner'
import { toolRegistry } from '../agent/tool-registry'
import { useBackgroundSessionStore } from '@renderer/stores/background-session-store'
import { useChatStore } from '@renderer/stores/chat-store'
import { isSessionForeground } from '@renderer/lib/agent/session-runtime-router'
import { resolveToolPath } from './fs-tool'
import { encodeStructuredToolResult } from './tool-result-format'
import type { ToolHandler } from './tool-types'

function resolveSshConnectionId(filePath: string, sshConnectionId?: string): string | undefined {
  if (!sshConnectionId) return undefined
  const isWindowsPath = /^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('\\\\')
  return isWindowsPath ? undefined : sshConnectionId
}

const openPreviewHandler: ToolHandler = {
  definition: {
    name: 'OpenPreview',
    description:
      'Open a file in the preview panel so the user can see it immediately. ' +
      'IMPORTANT: You MUST call this tool right after creating or editing any of these file types:\n' +
      '- HTML files (.html/.htm): renders a live preview in an iframe, great for data visualizations (ECharts, D3, Chart.js), interactive pages, reports, dashboards, etc.\n' +
      '- Spreadsheet files (.csv/.tsv): shows an editable table view with undo/redo and search.\n' +
      'When the user asks you to create a chart, visualization, single-page app, report, or any visual output, ' +
      'prefer generating a self-contained HTML file (with inline CSS/JS and CDN libraries like ECharts, Chart.js, D3, etc.), ' +
      'then immediately call OpenPreview to show the result. This gives the user instant visual feedback without leaving the app.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path to the file to preview. Must be an existing file on disk.'
        },
        view_mode: {
          type: 'string',
          enum: ['preview', 'code'],
          description:
            'View mode: "preview" for rendered HTML view, "code" for source code with syntax highlighting. Defaults to "preview".'
        }
      },
      required: ['file_path']
    }
  },
  execute: async (input, ctx) => {
    const filePath = resolveToolPath(input.file_path, ctx.workingFolder)
    const viewMode = (input.view_mode as 'preview' | 'code' | undefined) ?? 'preview'
    const sshConnectionId = resolveSshConnectionId(filePath, ctx.sshConnectionId)

    if (ctx.sessionId && !isSessionForeground(ctx.sessionId)) {
      const sessionTitle =
        useChatStore.getState().sessions.find((session) => session.id === ctx.sessionId)?.title ??
        '后台会话'
      useBackgroundSessionStore.getState().addInboxItem({
        sessionId: ctx.sessionId,
        type: 'preview_ready',
        title: '新预览',
        description: `${sessionTitle} 有可查看的预览`,
        toolUseId: ctx.currentToolUseId,
        target: {
          kind: 'file',
          filePath,
          viewMode,
          ...(sshConnectionId ? { sshConnectionId } : {})
        }
      })
      toast.warning('后台会话有新预览', { description: sessionTitle })

      return encodeStructuredToolResult({
        success: true,
        message: `Queued preview for ${filePath}`
      })
    }

    const { useUIStore } = await import('@renderer/stores/ui-store')
    useUIStore.getState().openFilePreview(filePath, viewMode, sshConnectionId, ctx.sessionId)

    return encodeStructuredToolResult({
      success: true,
      message: `Opened ${filePath} in preview panel`
    })
  },
  requiresApproval: () => false
}

export function registerPreviewTools(): void {
  toolRegistry.register(openPreviewHandler)
}
