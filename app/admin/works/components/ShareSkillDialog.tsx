'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { WorkSkill } from '@/components/works/types'

interface ShareSkillDialogProps {
  skill: WorkSkill | null
  onOpenChange: (open: boolean) => void
}

export function ShareSkillDialog({ skill, onOpenChange }: ShareSkillDialogProps) {
  const [email, setEmail] = useState('')
  const [sharing, setSharing] = useState(false)

  async function share() {
    if (!skill) return
    const target = email.trim()
    if (!target) return
    setSharing(true)
    const response = await fetch(`/api/admin/works/${skill.id}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: target }),
    })
    const body = await response.json().catch(() => ({})) as { error?: string }
    setSharing(false)
    if (response.ok) {
      toast.success(`Skill shared with ${target}`)
      setEmail('')
      onOpenChange(false)
    } else {
      toast.error(body.error ?? 'Unable to share skill')
    }
  }

  return (
    <Dialog open={Boolean(skill)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share “{skill?.name}”</DialogTitle>
          <DialogDescription>The attorney you share with can use this skill; grant edit access from the API if needed.</DialogDescription>
        </DialogHeader>
        <Input
          type="email"
          value={email}
          onChange={event => setEmail(event.target.value)}
          placeholder="attorney@example.com"
          onKeyDown={event => { if (event.key === 'Enter') void share() }}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={sharing || !email.trim()} onClick={() => void share()}>
            {sharing ? 'Sharing…' : 'Share'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
