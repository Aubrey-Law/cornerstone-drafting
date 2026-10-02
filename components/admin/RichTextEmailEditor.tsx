'use client'

import { useEffect, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import {
  Bold,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Maximize2,
  Minimize2,
  Redo2,
  RemoveFormatting,
  Underline,
  Undo2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DragResizeHandle, useDragResize } from '@/components/ui/drag-resize'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { sanitizeEmailHtml } from '@/lib/email/templateShared'
import { cn } from '@/lib/utils'

// Tags/attributes we keep in the composed email HTML. execCommand can emit a
// few extra wrappers (e.g. <font>, style attrs); we strip them so the payload
// stays clean and predictable for the email pipeline.
const SANITIZE_CONFIG = {
  ALLOWED_TAGS: ['b', 'strong', 'i', 'em', 'u', 'a', 'ul', 'ol', 'li', 'p', 'br', 'span', 'div'],
  ALLOWED_ATTR: ['href', 'target', 'rel'],
}

/**
 * Plain `dompurify`, not `isomorphic-dompurify`: the isomorphic build does a
 * top-level `require('jsdom')`, and jsdom's `html-encoding-sniffer` requires an
 * ESM file, so Next pulls it into the server bundle and the lambda dies at load
 * with ERR_REQUIRE_ESM — taking out every page whose module graph reaches this
 * editor. See the same note in lib/email/templateShared.ts.
 *
 * Both callers below run in the browser, but fall back to the email pipeline's
 * allowlist (identical tags) if this is ever reached without a DOM.
 */
function sanitize(html: string): string {
  if (typeof window === 'undefined' || !DOMPurify.isSupported) {
    return sanitizeEmailHtml(html ?? '')
  }
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
  variableOptions?: Array<{ key: string; label: string; value?: string }>
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
  variableOptions = [],
}: RichTextEmailEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const selectedRangeRef = useRef<Range | null>(null)
  const editedAnchorRef = useRef<HTMLAnchorElement | null>(null)
  const [expanded, setExpanded] = useState(false)
  // Set once the operator drags the resize handle. Until then the body has no
  // height of its own and simply grows with the message.
  const resize = useDragResize(editorRef, { disabled })
  const [linkEditorOpen, setLinkEditorOpen] = useState(false)
  const [editingLink, setEditingLink] = useState(false)
  const [linkText, setLinkText] = useState('')
  const [linkUrl, setLinkUrl] = useState('')

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

  function openLinkEditor(anchor?: HTMLAnchorElement | null) {
    if (disabled) return

    const editor = editorRef.current
    const selection = window.getSelection()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    const selectionAnchor = range?.commonAncestorContainer
    const selectionElement = selectionAnchor instanceof Element ? selectionAnchor : selectionAnchor?.parentElement
    const selectedAnchor = anchor ?? selectionElement?.closest<HTMLAnchorElement>('a') ?? null
    const anchorInEditor = selectedAnchor && editor?.contains(selectedAnchor) ? selectedAnchor : null
    const rangeInEditor = range && editor?.contains(range.commonAncestorContainer) ? range.cloneRange() : null

    editedAnchorRef.current = anchorInEditor
    selectedRangeRef.current = rangeInEditor
    setEditingLink(Boolean(anchorInEditor))
    setLinkText(anchorInEditor?.textContent ?? rangeInEditor?.toString() ?? '')
    setLinkUrl(anchorInEditor?.getAttribute('href') ?? '')
    setLinkEditorOpen(true)
  }

  function saveLink() {
    const editor = editorRef.current
    const text = linkText.trim()
    const url = linkUrl.trim()
    if (!editor || !text || !url) return

    const href = /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`
    const existingAnchor = editedAnchorRef.current

    if (existingAnchor && editor.contains(existingAnchor)) {
      existingAnchor.textContent = text
      existingAnchor.setAttribute('href', href)
      existingAnchor.setAttribute('target', '_blank')
      existingAnchor.setAttribute('rel', 'noopener noreferrer')
    } else {
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.target = '_blank'
      anchor.rel = 'noopener noreferrer'
      anchor.textContent = text

      const range = selectedRangeRef.current
      if (range && editor.contains(range.commonAncestorContainer)) {
        range.deleteContents()
        range.insertNode(anchor)
      } else {
        editor.append(anchor)
      }
    }

    emit()
    setLinkEditorOpen(false)
    editedAnchorRef.current = null
    selectedRangeRef.current = null
    requestAnimationFrame(() => editor.focus())
  }

  function removeLink() {
    const editor = editorRef.current
    const anchor = editedAnchorRef.current
    if (!editor || !anchor || !editor.contains(anchor)) return
    anchor.replaceWith(document.createTextNode(anchor.textContent ?? ''))
    emit()
    setLinkEditorOpen(false)
    editedAnchorRef.current = null
    selectedRangeRef.current = null
    requestAnimationFrame(() => editor.focus())
  }

  function insertVariable(key: string) {
    if (!key || disabled) return
    const editor = editorRef.current
    editor?.focus()
    const range = selectedRangeRef.current
    if (range && editor?.contains(range.commonAncestorContainer)) {
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    }
    const option = variableOptions.find(item => item.key === key)
    document.execCommand('insertText', false, option?.value || `{{${key}}}`)
    selectedRangeRef.current = null
    emit()
  }

  return (
    <div className="rounded-md border border-input bg-transparent shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-1.5 py-1">
        <ToolbarButton onClick={() => exec('bold')} disabled={disabled} title="Bold (Cmd+B)">
          <Bold className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec('italic')} disabled={disabled} title="Italic (Cmd+I)">
          <Italic className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec('underline')} disabled={disabled} title="Underline (Cmd+U)">
          <Underline className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec('insertUnorderedList')} disabled={disabled} title="Bulleted list">
          <List className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec('insertOrderedList')} disabled={disabled} title="Numbered list">
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={() => openLinkEditor()} disabled={disabled} title="Insert or edit link">
          <LinkIcon className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec('removeFormat')} disabled={disabled} title="Clear formatting">
          <RemoveFormatting className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec('undo')} disabled={disabled} title="Undo (Cmd+Z)">
          <Undo2 className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec('redo')} disabled={disabled} title="Redo (Cmd+Shift+Z)">
          <Redo2 className="h-3.5 w-3.5" />
        </ToolbarButton>
        {variableOptions.length > 0 && (
          <select
            aria-label="Insert variable"
            defaultValue=""
            disabled={disabled}
            onMouseDown={() => {
              const selection = window.getSelection()
              const range = selection?.rangeCount ? selection.getRangeAt(0) : null
              if (range && editorRef.current?.contains(range.commonAncestorContainer)) {
                selectedRangeRef.current = range.cloneRange()
              }
            }}
            onChange={event => {
              insertVariable(event.target.value)
              event.target.value = ''
            }}
            className="ml-1 h-7 max-w-32 rounded border border-input bg-background px-1 text-micro"
          >
            <option value="">Insert variable…</option>
            {variableOptions.map(option => (
              <option key={option.key} value={option.key}>{option.label}</option>
            ))}
          </select>
        )}
        <div className="ml-auto">
          <ToolbarButton
            onClick={() => {
              // A dragged height outranks both presets, so the toggle drops it —
              // otherwise the button would look broken after a resize.
              resize.reset()
              setExpanded(prev => !prev)
            }}
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
        onClick={event => {
          const target = event.target
          const anchor = target instanceof Element ? target.closest<HTMLAnchorElement>('a') : null
          if (!anchor) return
          event.preventDefault()
          openLinkEditor(anchor)
        }}
        // Without a dragged height the body has no cap: a long message shows in
        // full and the surrounding pane scrolls, rather than the last
        // paragraphs hiding inside a nested scroll area.
        style={resize.height === null ? undefined : { height: resize.height }}
        className={cn(
          'px-3 py-2 text-sm leading-relaxed outline-none',
          resize.height === null
            ? cn('overflow-y-visible', expanded ? 'min-h-[20rem]' : 'min-h-[9rem]')
            : 'overflow-y-auto',
          '[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-primary [&_a]:underline',
          'empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]',
          disabled && 'opacity-60',
        )}
      />
      <DragResizeHandle controls={resize} label="Resize message area" disabled={disabled} className="rounded-b-md" />
      <Dialog open={linkEditorOpen} onOpenChange={setLinkEditorOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingLink ? 'Edit link' : 'Insert link'}</DialogTitle>
            <DialogDescription>Set the text readers will see and the address it opens.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={event => {
              event.preventDefault()
              saveLink()
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor={`${id ?? 'email-body'}-link-text`}>Link text</Label>
              <Input
                id={`${id ?? 'email-body'}-link-text`}
                value={linkText}
                onChange={event => setLinkText(event.target.value)}
                placeholder="View our intake form"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${id ?? 'email-body'}-link-url`}>Link URL</Label>
              <Input
                id={`${id ?? 'email-body'}-link-url`}
                value={linkUrl}
                onChange={event => setLinkUrl(event.target.value)}
                placeholder="https://example.com"
                inputMode="url"
              />
            </div>
            <DialogFooter>
              {editingLink && (
                <Button type="button" variant="destructive" onClick={removeLink}>
                  Remove link
                </Button>
              )}
              <Button type="button" variant="outline" onClick={() => setLinkEditorOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!linkText.trim() || !linkUrl.trim()}>
                {editingLink ? 'Save link' : 'Insert link'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
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
