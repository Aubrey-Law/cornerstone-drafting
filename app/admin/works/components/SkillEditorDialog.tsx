'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface SkillEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  initialValue: string
  saving: boolean
  onSave: (skillMd: string) => void
}

export function SkillEditorDialog({ open, onOpenChange, title, initialValue, saving, onSave }: SkillEditorDialogProps) {
  const [value, setValue] = useState(initialValue)

  useEffect(() => {
    if (open) setValue(initialValue)
  }, [open, initialValue])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>SKILL.md is the portable source of truth — YAML frontmatter plus Markdown instructions.</DialogDescription>
        </DialogHeader>
        <Textarea
          value={value}
          onChange={event => setValue(event.target.value)}
          spellCheck={false}
          className="min-h-[420px] flex-1 font-mono text-xs leading-5"
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={saving} onClick={() => onSave(value)}>
            {saving ? 'Saving…' : 'Save skill'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
