'use client'

import {
  useRef,
  type KeyboardEventHandler,
  type RefObject,
} from 'react'
import { Bold, Italic, List, ListOrdered, Underline } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { DragResizeHandle, useDragResize } from '@/components/ui/drag-resize'
import { cn } from '@/lib/utils'

type Format = 'bold' | 'italic' | 'underline' | 'bullets' | 'numbering'

interface FormattedNoteEditorProps {
  value: string
  onChange: (value: string) => void
  ariaLabel: string
  placeholder?: string
  rows?: number
  className?: string
  textareaRef?: RefObject<HTMLTextAreaElement | null>
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>
}

const FORMATS: Array<{
  value: Format
  label: string
  icon: typeof Bold
}> = [
  { value: 'bold', label: 'Bold', icon: Bold },
  { value: 'italic', label: 'Italic', icon: Italic },
  { value: 'underline', label: 'Underline', icon: Underline },
  { value: 'bullets', label: 'Bulleted list', icon: List },
  { value: 'numbering', label: 'Numbered list', icon: ListOrdered },
]

export function FormattedNoteEditor({
  value,
  onChange,
  ariaLabel,
  placeholder,
  rows = 3,
  className,
  textareaRef,
  onKeyDown,
}: FormattedNoteEditorProps) {
  const localRef = useRef<HTMLTextAreaElement>(null)
  const activeRef = textareaRef ?? localRef
  // Until the operator drags the bottom edge, the note sizes itself to what
  // they have typed.
  const resize = useDragResize(activeRef)

  function applyFormat(format: Format) {
    const textarea = activeRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selected = value.slice(start, end)
    let replacement = selected
    let selectionStart = start
    let selectionEnd = end

    if (format === 'bold' || format === 'italic' || format === 'underline') {
      const marker = format === 'bold' ? '**' : format === 'italic' ? '*' : '++'
      const content = selected || (format === 'bold' ? 'bold text' : format === 'italic' ? 'italic text' : 'underlined text')
      replacement = `${marker}${content}${marker}`
      selectionStart = start + marker.length
      selectionEnd = selectionStart + content.length
    } else {
      const prefixLine = (line: string, index: number) => {
        const clean = line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')
        return format === 'bullets' ? `- ${clean}` : `${index + 1}. ${clean}`
      }
      const content = selected || 'List item'
      replacement = content.split('\n').map(prefixLine).join('\n')
      selectionEnd = start + replacement.length
    }

    onChange(`${value.slice(0, start)}${replacement}${value.slice(end)}`)
    window.requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(selectionStart, selectionEnd)
    })
  }

  return (
    <div className="overflow-hidden rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring/50">
      <div className="flex items-center gap-0.5 border-b border-border bg-muted/30 px-1 py-1" aria-label="Note formatting">
        {FORMATS.map(format => {
          const Icon = format.icon
          return (
            <Button
              key={format.value}
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              aria-label={format.label}
              title={format.label}
              onClick={() => applyFormat(format.value)}
            >
              <Icon className="h-3.5 w-3.5" />
            </Button>
          )
        })}
      </div>
      <Textarea
        ref={activeRef}
        aria-label={ariaLabel}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        style={resize.height === null ? undefined : { height: resize.height, minHeight: 0 }}
        className={cn(
          'resize-none rounded-none border-0 text-sm shadow-none focus-visible:ring-0',
          resize.height !== null && 'field-sizing-fixed overflow-y-auto',
          className,
        )}
        onKeyDown={onKeyDown}
      />
      <DragResizeHandle controls={resize} label={`Resize ${ariaLabel.toLowerCase()}`} />
    </div>
  )
}
