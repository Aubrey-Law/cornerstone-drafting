'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Briefcase, MessageSquarePlus, MoreHorizontal, Pencil, Trash2, UserRound } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

export interface AssistantChatSummary {
  id: string
  title: string | null
  context_type: 'general' | 'matter' | 'lead'
  updated_at: string
}

interface ChatHistorySidebarProps {
  chats: AssistantChatSummary[]
  activeChatId: string | null
  onChanged: () => Promise<void> | void
}

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession()
  return {
    'Content-Type': 'application/json',
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
  }
}

export function ChatHistorySidebar({ chats, activeChatId, onChanged }: ChatHistorySidebarProps) {
  const router = useRouter()
  const [renameTarget, setRenameTarget] = useState<AssistantChatSummary | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<AssistantChatSummary | null>(null)

  async function renameChat() {
    if (!renameTarget || !renameValue.trim()) return
    const response = await fetch(`/api/admin/assistant/chats/${renameTarget.id}`, {
      method: 'PATCH',
      headers: await authHeaders(),
      body: JSON.stringify({ title: renameValue.trim() }),
    })
    if (response.ok) {
      setRenameTarget(null)
      await onChanged()
    } else {
      toast.error('Unable to rename chat')
    }
  }

  async function deleteChat() {
    if (!deleteTarget) return
    const response = await fetch(`/api/admin/assistant/chats/${deleteTarget.id}`, {
      method: 'DELETE',
      headers: await authHeaders(),
    })
    if (response.ok) {
      const wasActive = deleteTarget.id === activeChatId
      setDeleteTarget(null)
      await onChanged()
      if (wasActive) router.push('/admin/assistant')
    } else {
      toast.error('Unable to delete chat')
    }
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col gap-2 border-r border-border pr-3">
      <Button type="button" variant="outline" size="sm" onClick={() => router.push('/admin/assistant')}>
        <MessageSquarePlus className="h-4 w-4" /> New chat
      </Button>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {chats.length === 0 && (
          <p className="px-2 py-4 text-xs text-muted-foreground">No chats yet. Your conversations are saved here.</p>
        )}
        {chats.map(chat => (
          <div
            key={chat.id}
            className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm hover:bg-accent ${chat.id === activeChatId ? 'bg-selected text-selected-foreground' : ''}`}
          >
            <button
              type="button"
              onClick={() => router.push(`/admin/assistant/chat/${chat.id}`)}
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              title={`${chat.title ?? 'New chat'}${chat.context_type === 'general' ? '' : ` · ${chat.context_type} chat`}`}
            >
              {chat.context_type === 'matter' && <Briefcase aria-label="Matter chat" className="h-3 w-3 shrink-0 text-muted-foreground" />}
              {chat.context_type === 'lead' && <UserRound aria-label="Lead chat" className="h-3 w-3 shrink-0 text-muted-foreground" />}
              <span className="truncate">{chat.title ?? 'New chat'}</span>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => { setRenameTarget(chat); setRenameValue(chat.title ?? '') }}>
                  <Pencil className="h-3.5 w-3.5" /> Rename
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget(chat)}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
      </div>

      <Dialog open={Boolean(renameTarget)} onOpenChange={open => { if (!open) setRenameTarget(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Rename chat</DialogTitle></DialogHeader>
          <Input
            value={renameValue}
            onChange={event => setRenameValue(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') void renameChat() }}
            autoFocus
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRenameTarget(null)}>Cancel</Button>
            <Button type="button" disabled={!renameValue.trim()} onClick={() => void renameChat()}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={open => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteTarget?.title ?? 'New chat'}” and its messages will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void deleteChat()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  )
}
