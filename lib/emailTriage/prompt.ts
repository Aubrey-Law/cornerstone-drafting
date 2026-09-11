import { PROMPT_INJECTION_GUARDRAIL, quoteUserContent } from '@/lib/anthropic'
import { getFirmConfig } from '@/lib/firmConfig'

/**
 * Prompt construction for a triage draft.
 *
 * Every other model call in this application reads text the firm collected
 * itself — its own intake forms, its own notes. This one reads arbitrary email
 * from the open internet, and the output is a reply the attorney may send from
 * his own address. It is the only prompt here with a genuine adversary, so the
 * untrusted text is fenced, the fence is enforced, and everything that must not
 * be attacker-influenced is computed in code rather than asked of the model.
 */

const QUOTE_TAG = 'inbound_email'

/** Enough of a message to answer; past this it is a newsletter or a docket. */
const MAX_QUOTED_CHARS = 8_000

/**
 * Neutralise the fence before quoting inside it.
 *
 * `quoteUserContent` wraps untrusted text in `<inbound_email>` tags and says
 * to treat the contents as data — but it does not escape its own closing tag,
 * so a sender who writes `</inbound_email>` mid-message steps outside the fence
 * and the rest of their email reads as instructions. Anyone can email the firm,
 * which makes that a one-line attack.
 *
 * Fixed locally rather than in `packages/citations/src/prompt.ts`: that helper
 * has ten call sites reading intake text, and widening its behaviour belongs in
 * its own change with its own tests.
 */
export function sanitizeQuoted(text: string): string {
  const clipped = text.length > MAX_QUOTED_CHARS
    ? `${text.slice(0, MAX_QUOTED_CHARS)}\n[message truncated]`
    : text

  return clipped
    // Defang both halves of the fence, however the sender spelled them.
    .replace(new RegExp(`</?\\s*${QUOTE_TAG}\\s*/?>`, 'gi'), `[${QUOTE_TAG}]`)
    // Control characters other than tab, newline and carriage return, plus the
    // Unicode format and zero-width characters: invisible to whoever reviews the
    // draft, not invisible to the model.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, '')
}

/** Wrap the inbound message as data, with the fence made tamper-resistant. */
export function quoteInboundEmail(args: {
  fromName: string | null
  fromEmail: string
  subject: string
  receivedAt: string
  body: string
}): string {
  const heading = [
    `From: ${args.fromName ? `${args.fromName} <${args.fromEmail}>` : args.fromEmail}`,
    `Subject: ${args.subject}`,
    `Received: ${args.receivedAt}`,
  ].join('\n')

  return quoteUserContent(QUOTE_TAG, sanitizeQuoted(`${heading}\n\n${args.body}`))
}

/**
 * The reply subject, computed rather than generated.
 *
 * Two reasons, and neither is style. Gmail threads on subject as well as on
 * `threadId`, so a subject the model invented can silently orphan the reply;
 * and a subject line is a thing the client sees, which is not somewhere a
 * sender's text should be able to reach.
 */
export function replySubject(subject: string | null | undefined): string {
  const trimmed = (subject ?? '').trim()
  if (!trimmed) return 'Re: your message'
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`
}

/**
 * The system prompt for a sender Cornerstone has no record of.
 *
 * `loadLeadContext` and `loadMatterContext` cover the people the firm knows.
 * This is the other path, and it is deliberately the most constrained of the
 * three: there is no file, no history, and no engagement, so the draft's job is
 * to acknowledge, qualify, and offer a consultation — not to answer a legal
 * question for a stranger.
 */
export function buildUnknownSenderSystemPrompt(args?: { contactNote?: string | null }): string {
  const firm = getFirmConfig()
  return [
    `You are drafting email on behalf of ${firm.attorneyName}, a solo estate planning attorney at ${firm.firmName} in ${firm.city}.`,
    '',
    'The sender is not a client and has no file with the firm. That governs everything you write:',
    '- Do not give legal advice, and do not answer a legal question on the merits.',
    '- Do not quote a fee, estimate one, or imply what representation would cost.',
    '- Do not commit to any date, deadline, or outcome.',
    '- Do not write anything implying an attorney-client relationship exists. It does not.',
    '- Do not claim to have reviewed a document, and do not assume facts the sender did not state.',
    '',
    'Write a short, warm acknowledgement that thanks them for reaching out, reflects back what',
    'they asked in one sentence so they know it was read, asks at most two questions needed to',
    'work out whether the firm can help, and offers a consultation. Four short paragraphs at most.',
    args?.contactNote ? `\nWhat the firm knows about this person: ${args.contactNote}` : '',
    '',
    PROMPT_INJECTION_GUARDRAIL,
  ].filter(Boolean).join('\n')
}

/**
 * What to do with the quoted message. Kept beside the guardrail so the two are
 * read together.
 */
export const TRIAGE_INSTRUCTIONS = [
  'Draft the body of a reply to the email quoted below.',
  '',
  'Rules:',
  '- Plain text. No markdown, no subject line, no To/From headers, no commentary.',
  '- Open with the sender’s first name if you know it; sign off as the attorney.',
  '- Answer what was actually asked. Do not pad, and do not restate the whole thread.',
  '- Invent nothing. No dates, fees, filing deadlines, or legal conclusions that are not',
  '  already established in the context above.',
  '- Anything the attorney must check before sending goes in square brackets as',
  '  [CONFIRM: ...]. Prefer that over a confident guess.',
  '- If the message needs a real decision from the attorney rather than a reply, say so',
  '  in one line instead of drafting around it.',
].join('\n')
