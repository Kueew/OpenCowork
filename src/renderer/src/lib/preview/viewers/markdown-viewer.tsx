import * as React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeEditor } from '@renderer/components/editor/CodeEditor'
import type { ViewerProps } from '../viewer-registry'
import { createMarkdownComponents } from './markdown-components'

export function MarkdownViewer({
  filePath,
  content,
  viewMode,
  onContentChange
}: ViewerProps): React.JSX.Element {
  if (viewMode === 'code') {
    return <CodeEditor filePath={filePath} content={content} onChange={onContentChange} />
  }

  return (
    <div className="size-full overflow-y-auto p-6">
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={createMarkdownComponents(filePath)}>
          {content}
        </ReactMarkdown>
      </div>
    </div>
  )
}
