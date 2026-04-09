import * as React from 'react'
import type { ToolResultContent, UnifiedMessage } from '@renderer/lib/api/types'
import { cn } from '@renderer/lib/utils'
import { MessageItem } from './MessageItem'
import { buildRenderableMessageMeta, getMessageLookup, getToolResultsLookup } from './transcript-utils'

interface TranscriptMessageListProps {
  messages: UnifiedMessage[]
  streamingMessageId?: string | null
  className?: string
}

type ToolResultsLookup = Map<string, { content: ToolResultContent; isError?: boolean }>

interface VirtualTranscriptMessageRowProps {
  rowIndex: number
  message: UnifiedMessage
  isStreaming: boolean
  isLastUserMessage: boolean
  isLastAssistantMessage: boolean
  toolResults?: ToolResultsLookup
}

const VirtualTranscriptMessageRow = React.memo(function VirtualTranscriptMessageRow({
  rowIndex,
  message,
  isStreaming,
  isLastUserMessage,
  isLastAssistantMessage,
  toolResults
}: VirtualTranscriptMessageRowProps): React.JSX.Element {
  return (
    <div data-index={rowIndex} className="mx-auto max-w-3xl px-4 pb-6">
      <MessageItem
        message={message}
        messageId={message.id}
        isStreaming={isStreaming}
        isLastUserMessage={isLastUserMessage}
        isLastAssistantMessage={isLastAssistantMessage}
        disableAnimation
        toolResults={toolResults}
        renderMode="transcript"
      />
    </div>
  )
})

export function TranscriptMessageList({
  messages,
  streamingMessageId = null,
  className
}: TranscriptMessageListProps): React.JSX.Element {
  const toolResultsLookup = React.useMemo(() => getToolResultsLookup(messages), [messages])
  const renderableMeta = React.useMemo(
    () => buildRenderableMessageMeta(messages, streamingMessageId),
    [messages, streamingMessageId]
  )
  const messageLookup = React.useMemo(() => getMessageLookup(messages), [messages])

  if (renderableMeta.length === 0) {
    return <div className="text-sm text-muted-foreground/70">暂无回放</div>
  }

  return (
    <div className={cn('not-prose h-[min(60vh,40rem)] min-h-[20rem] overflow-y-auto', className)}>
      {renderableMeta.map((meta, rowIndex) => {
        const message = messageLookup.get(meta.messageId)

        if (!message) {
          return null
        }

        return (
          <VirtualTranscriptMessageRow
            key={meta.messageId}
            rowIndex={rowIndex}
            message={message}
            isStreaming={streamingMessageId === message.id}
            isLastUserMessage={meta.isLastUserMessage}
            isLastAssistantMessage={meta.isLastAssistantMessage}
            toolResults={toolResultsLookup.get(message.id)}
          />
        )
      })}
    </div>
  )
}
