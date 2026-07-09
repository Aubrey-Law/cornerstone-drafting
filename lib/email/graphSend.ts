import {
  getAccessToken,
  getMicrosoftConnectionForUser,
  hasMailSendScope,
} from '@/lib/microsoftCalendar'

export class GraphSendError extends Error {
  readonly kind: 'no_connection' | 'missing_scope' | 'graph_error'
  constructor(kind: 'no_connection' | 'missing_scope' | 'graph_error', message: string) {
    super(message)
    this.kind = kind
    this.name = 'GraphSendError'
  }
}

export interface GraphSendArgs {
  to: string
  cc?: string[]
  subject: string
  html?: string
  text?: string
  replyTo?: string
  userId?: string | null
}

export interface GraphSendResult {
  fromAddress: string | null
  messageId: string | null
}

interface GraphRecipient {
  emailAddress: { address: string; name?: string }
}

function recipient(addr: string): GraphRecipient {
  return { emailAddress: { address: addr.trim() } }
}

/**
 * Send via Microsoft Graph `me/sendMail` using a connected Outlook mailbox.
 */
export async function sendViaGraph(args: GraphSendArgs): Promise<GraphSendResult> {
  const conn = await getMicrosoftConnectionForUser(args.userId)
  if (!conn) {
    throw new GraphSendError('no_connection', 'Microsoft mailbox is not connected')
  }
  if (!hasMailSendScope(conn.scopes)) {
    throw new GraphSendError(
      'missing_scope',
      'Microsoft connection is missing Mail.Send scope — reconnect from Settings',
    )
  }

  let token: string
  try {
    token = await getAccessToken(args.userId ?? conn.user_id)
  } catch (err) {
    throw new GraphSendError(
      'no_connection',
      err instanceof Error ? err.message : 'Failed to acquire Graph access token',
    )
  }

  const bodyContent = args.text ?? args.html ?? ''
  const message = {
    message: {
      subject: args.subject,
      body: { contentType: args.text ? 'Text' : 'HTML', content: bodyContent },
      toRecipients: [recipient(args.to)],
      ccRecipients: args.cc && args.cc.length > 0 ? args.cc.map(recipient) : undefined,
      replyTo: args.replyTo ? [recipient(args.replyTo)] : undefined,
    },
    saveToSentItems: true,
  }

  const r = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(message),
  })

  if (!r.ok && r.status !== 202) {
    let detail = `${r.status} ${r.statusText}`
    try {
      const j = (await r.json()) as { error?: { message?: string; code?: string } }
      if (j.error?.message) detail = `${j.error.code ?? r.status}: ${j.error.message}`
    } catch {
      /* ignore */
    }
    throw new GraphSendError('graph_error', detail)
  }

  return {
    fromAddress: conn.email,
    messageId: null,
  }
}
