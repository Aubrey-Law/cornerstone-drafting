'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

function withUnderlineLinks(value: string): string {
  return value.replace(/\+\+([^+\n]+)\+\+/g, '[$1](note-underline:)')
}

export function FormattedNote({
  children,
  className,
}: {
  children: string
  className?: string
}) {
  return (
    <div className={cn('break-words text-sm [&_p]:whitespace-pre-wrap', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children: content }) => <p>{content}</p>,
          strong: ({ children: content }) => <strong className="font-semibold">{content}</strong>,
          em: ({ children: content }) => <em>{content}</em>,
          ul: ({ children: content }) => <ul className="list-disc space-y-1 pl-5">{content}</ul>,
          ol: ({ children: content }) => <ol className="list-decimal space-y-1 pl-5">{content}</ol>,
          li: ({ children: content }) => <li>{content}</li>,
          a: ({ children: content, href }) => href === 'note-underline:'
            ? <u className="underline underline-offset-2">{content}</u>
            : <span>{content}</span>,
        }}
      >
        {withUnderlineLinks(children)}
      </ReactMarkdown>
    </div>
  )
}
