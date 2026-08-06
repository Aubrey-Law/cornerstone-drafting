import { buildChatDocxBuffer, type ChatDocxMessage } from '@/lib/chatDocx'
import type { FloatingChatMessage } from './ChatMessage'

function floatingChatToDocxMessages(messages: FloatingChatMessage[]): ChatDocxMessage[] {
  return messages
    .filter(m => m.content.trim())
    .map(m => ({
      role: m.role,
      content: m.content.trim(),
      timestamp: m.timestamp,
    }))
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const ASSISTANT_LABEL = process.env.NEXT_PUBLIC_FIRM_NAME
  ? `${process.env.NEXT_PUBLIC_FIRM_NAME} Assistant`
  : 'AI Assistant'

function roleLabel(role: FloatingChatMessage['role']): string {
  return role === 'user' ? 'Attorney' : ASSISTANT_LABEL
}

export function chatTranscriptText(messages: FloatingChatMessage[]): string {
  const header = `${ASSISTANT_LABEL} — Chat Transcript\nExported ${new Date().toLocaleString('en-US')}\n\n`
  const body = messages
    .filter(m => m.content.trim())
    .map(m => `[${formatTimestamp(m.timestamp)}] ${roleLabel(m.role)}:\n${m.content.trim()}`)
    .join('\n\n')
  return header + body + '\n'
}

export function chatNoteText(messages: FloatingChatMessage[]): string {
  return messages
    .filter(m => m.content.trim())
    .map(m => `${roleLabel(m.role)}: ${m.content.trim()}`)
    .join('\n\n')
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadChatAsText(messages: FloatingChatMessage[], baseName: string) {
  const blob = new Blob([chatTranscriptText(messages)], { type: 'text/plain;charset=utf-8' })
  triggerDownload(blob, `${baseName}.txt`)
}

const DOCX_BLOB_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export async function downloadChatAsDocx(messages: FloatingChatMessage[], baseName: string) {
  const buffer = await buildChatDocxBuffer(floatingChatToDocxMessages(messages))
  const blob = new Blob([new Uint8Array(buffer)], { type: DOCX_BLOB_TYPE })
  triggerDownload(blob, `${baseName}.docx`)
}
