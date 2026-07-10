export type ChatDocxMessage = {
  role: 'user' | 'assistant'
  content: string
  timestamp?: string
}

const ASSISTANT_LABEL = process.env.NEXT_PUBLIC_FIRM_NAME
  ? `${process.env.NEXT_PUBLIC_FIRM_NAME} Assistant`
  : 'AI Assistant'

function formatTimestamp(iso: string | undefined): string {
  if (!iso) return ''
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

function roleLabel(role: ChatDocxMessage['role']): string {
  return role === 'user' ? 'Attorney' : ASSISTANT_LABEL
}

/** Build a .docx buffer for a chat transcript or single assistant reply. */
export async function buildChatDocxBuffer(
  messages: ChatDocxMessage[],
  options?: { title?: string; exportedAt?: Date },
): Promise<Buffer> {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = await import('docx')

  const title = options?.title ?? `${ASSISTANT_LABEL} — Chat Transcript`
  const exportedAt = options?.exportedAt ?? new Date()

  const children: InstanceType<typeof Paragraph>[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: title, bold: true })],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Exported ${exportedAt.toLocaleString('en-US')}`,
          italics: true,
          color: '666666',
        }),
      ],
    }),
    new Paragraph({ text: '' }),
  ]

  for (const message of messages) {
    const text = message.content.trim()
    if (!text) continue
    const ts = formatTimestamp(message.timestamp)
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: `${roleLabel(message.role)} `, bold: true }),
          ...(ts
            ? [new TextRun({ text: `· ${ts}`, color: '888888', size: 18 })]
            : []),
        ],
      }),
    )
    for (const line of text.split('\n')) {
      children.push(new Paragraph({ text: line }))
    }
    children.push(new Paragraph({ text: '' }))
  }

  const doc = new Document({ sections: [{ properties: {}, children }] })
  return Packer.toBuffer(doc)
}

export function simpleChatToDocxMessages(
  messages: Array<{ role: 'user' | 'assistant'; text: string; timestamp?: string }>,
): ChatDocxMessage[] {
  return messages
    .filter(m => m.text.trim())
    .map(m => ({
      role: m.role,
      content: m.text.trim(),
      timestamp: m.timestamp,
    }))
}

/** When saving/exporting one assistant reply, include the preceding user question when present. */
export function sliceForAssistantExport<
  T extends { role: 'user' | 'assistant'; text: string; timestamp?: string },
>(messages: T[], assistantIndex: number): T[] {
  const msg = messages[assistantIndex]
  if (!msg || msg.role !== 'assistant') return messages.slice(assistantIndex, assistantIndex + 1)
  if (assistantIndex > 0 && messages[assistantIndex - 1]?.role === 'user') {
    return messages.slice(assistantIndex - 1, assistantIndex + 1)
  }
  return [msg]
}

export function assistantDocxFilenameBase(matterLabel: string, suffix: string): string {
  const slug = matterLabel
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'matter'
  const date = new Date().toISOString().slice(0, 10)
  const safeSuffix = suffix.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 40)
  return `Assistant-${slug}-${safeSuffix}-${date}`
}
