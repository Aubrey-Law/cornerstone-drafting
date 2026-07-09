'use client'

import { useEffect, useRef, useState } from 'react'
import DOMPurify from 'isomorphic-dompurify'
import { Bold, Italic, Link as LinkIcon, List, ListOrdered, Maximize2, Minimize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Tags/attributes we keep in the composed email HTML. execCommand can emit a
// few extra wrappers (e.g. <font>, style attrs); we strip them so the payload
// stays clean and predictable for the email pipeline.
const SANITIZE_CONFIG = {
  ALLOWED_TAGS: ['b', 'strong', 'i', 'em', 'u', 'a', 'ul', 'ol', 'li', 'p', 'br', 'span', 'div'],
  ALLOWED_ATTR: ['href', 'target', 'rel'],
}

function sanitize(html: string): string {
  return DOMPurify.sanitize(html ?? '', SANITIZE_CONFIG)
}

/** Plain-text projection of composed email HTML (for validation/previews). */
export function emailHtmlToText(html: string): string {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|ul|ol)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim()
}

/** True when the editor holds no real content (handles stray <br>/<div> shells). */
export function emailHtmlIsEmpty(html: string): boolean {
  return emailHtmlToText(html).length === 0
}

interface RichTextEmailEditorProps {
  /** Current HTML value (controlled). Set to '' to clear. */
  valueHtml: string
  onChange: (html: string) => void
  disabled?: boolean
  placeholder?: string
  id?: string
  ariaLabel?: string
}

/**
 * Lightweight contentEditable email body editor with a small formatting
 * toolbar (bold, italic, bullet/numbered lists, links). Emits sanitized HTML
 * via onChange so callers can feed it straight into the send-email pipeline.
 */
export function RichTextEmailEditor({
  valueHtml,
  onChange,
  disabled,
  placeholder,
  id,
  ariaLabel,
}: RichTextEmailEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const [expanded, setExpanded] = useState(false)

  // Reflect external value changes (template applied, cleared on open) without
  // clobbering the caret mid-type: only write when the incoming HTML differs
  // from what's already in the DOM — during typing they match, so we skip.
  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    const clean = sanitize(valueHtml)
    if (el.innerHTML !== clean) el.innerHTML = clean
  }, [valueHtml])

  function emit() {
    const el = editorRef.current
    if (!el) return
    onChange(sanitize(el.innerHTML))
  }

  function exec(command: string, value?: string) {
    if (disabled) return
    editorRef.current?.focus()
    document.execCommand(command, false, value)
    emit()
  }

  function insertLink() {
    if (disabled) return
    const url = window.prompt('Link URL', 'https://')?.trim()
    if (!url) return
    const href = /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`
    editorRef.current?.focus()
    document.execCommand('createLink', false, href)
    emit()
  }

  return (
    <div className="rounded-md border border-input bg-transparent shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
      <div className="flex items-center gap-0.5 border-b border-border px-1.5 py-1">
        <ToolbarButton onClick={() => exec('bold')} disabled={disabled} title="Bold (Cmd+B)">
          <Bold className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec('italic')} disabled={disabled} title="Italic (Cmd+I)">
          <Italic className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec('insertUnorderedList')} disabled={disabled} title="Bulleted list">
          <List className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec('insertOrderedList')} disabled={disabled} title="Numbered list">
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={insertLink} disabled={disabled} title="Insert link">
          <LinkIcon className="h-3.5 w-3.5" />
        </ToolbarButton>
        <div className="ml-auto">
          <ToolbarButton
            onClick={() => setExpanded(prev => !prev)}
            disabled={disabled}
            title={expanded ? 'Collapse message area' : 'Expand message area'}
          >
            {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </ToolbarButton>
        </div>
      </div>
      <div
        ref={editorRef}
        id={id}
        role="textbox"
        aria-label={ariaLabel}
        aria-multiline="true"
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={emit}
        onBlur={emit}
        className={cn(
          'overflow-y-auto px-3 py-2 text-sm leading-relaxed outline-none',
          expanded ? 'min-h-[20rem] max-h-[60dvh]' : 'min-h-[9rem] max-h-[40dvh]',
          '[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-accent [&_a]:underline',
          'empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]',
          disabled && 'opacity-60',
        )}
      />
    </div>
  )
}

function ToolbarButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  title: string
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      // Keep focus in the editor so execCommand applies to the current selection.
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="h-7 w-7 p-0 text-text-secondary"
    >
      {children}
    </Button>
  )
}
