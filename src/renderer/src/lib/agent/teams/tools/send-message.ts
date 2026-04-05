import { nanoid } from 'nanoid'
import type { ToolHandler } from '../../../tools/tool-types'
import { encodeStructuredToolResult, encodeToolError } from '../../../tools/tool-result-format'
import { teamEvents } from '../events'
import { useTeamStore } from '../../../../stores/team-store'
import type { TeamMessage, TeamMessageType } from '../types'
import { appendTeamRuntimeMessage } from '../runtime-client'

const VALID_TYPES: TeamMessageType[] = [
  'message',
  'broadcast',
  'shutdown_request',
  'shutdown_response',
  'idle_notification',
  'permission_request',
  'permission_response',
  'plan_approval_request',
  'plan_approval_response',
  'team_permission_update',
  'mode_set_request'
]

export const sendMessageTool: ToolHandler = {
  definition: {
    name: 'SendMessage',
    description:
      'Send a message to a teammate, broadcast to all teammates, or send a shutdown request. Use this for inter-agent communication within the team.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: [
            'message',
            'broadcast',
            'shutdown_request',
            'shutdown_response',
            'idle_notification',
            'permission_request',
            'permission_response',
            'plan_approval_request',
            'plan_approval_response',
            'team_permission_update',
            'mode_set_request'
          ],
          description:
            'Structured team message type. Use "message" for direct messages, "broadcast" for team-wide messages, and approval/protocol types for team coordination flows.'
        },
        recipient: {
          type: 'string',
          description:
            'Name of the recipient teammate (required for "message" and "shutdown_request")'
        },
        content: {
          type: 'string',
          description: 'Message content'
        },
        sender: {
          type: 'string',
          description: 'Your name as the sender (defaults to "lead")'
        },
        summary: {
          type: 'string',
          description: 'Optional short summary of the message'
        }
      },
      required: ['type', 'content']
    }
  },
  execute: async (input) => {
    const team = useTeamStore.getState().activeTeam
    if (!team) {
      return encodeToolError('No active team')
    }

    const msgType = String(input.type) as TeamMessageType
    if (!VALID_TYPES.includes(msgType)) {
      return encodeToolError(`Invalid message type: ${input.type}`)
    }

    const recipient = msgType === 'broadcast' ? 'all' : String(input.recipient ?? 'all')

    const msg: TeamMessage = {
      id: nanoid(8),
      from: input.sender ? String(input.sender) : 'lead',
      to: recipient,
      type: msgType,
      content: String(input.content),
      summary: input.summary ? String(input.summary) : undefined,
      timestamp: Date.now()
    }

    try {
      await appendTeamRuntimeMessage({
        teamName: team.name,
        message: msg
      })
      teamEvents.emit({ type: 'team_message', message: msg })

      return encodeStructuredToolResult({
        success: true,
        message_id: msg.id,
        type: msgType,
        to: recipient
      })
    } catch (error) {
      return encodeToolError(error instanceof Error ? error.message : String(error))
    }
  },
  requiresApproval: () => false
}
