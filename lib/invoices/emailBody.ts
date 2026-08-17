import type { InvoiceRenderData } from './types'

/**
 * The invoice as an HTML email body.
 *
 * This is the primary artifact, not a courtesy note wrapped around an
 * attachment: it renders on a phone, survives a blocked download, and works
 * even when the DOCX→PDF worker is unconfigured. The attachment rides along
 * when it exists.
 *
 * Table-based layout with inline styles because that is what email clients
 * actually render — the same constraint lib/email/brandWrapper.ts works under.
 * Output is a bare body fragment so sendEmail can brand-wrap it.
 */

const AMOUNT_STYLE = 'padding:8px 0;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;'
const LABEL_STYLE = 'padding:8px 0;text-align:left;'
const RULE = 'border-bottom:1px solid #e5e7eb;'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function paragraph(text: string): string {
  // Preserve the author's line breaks; everything else is escaped.
  return escapeHtml(text).replace(/\r?\n/g, '<br />')
}

export interface InvoiceEmailCopy {
  subject: string
  html: string
  text: string
}

/**
 * @param intro optional attorney-written note placed above the invoice.
 * @param pastDue renders the balance in the destructive tone and leads with it.
 */
export function buildInvoiceEmailHtml(
  data: InvoiceRenderData,
  options: { intro?: string | null; pastDue?: boolean } = {},
): string {
  const lines = data.lines
    .map(
      line => `<tr>
  <td style="${LABEL_STYLE}${RULE}font-size:14px;color:#111827;">${escapeHtml(line.description)}</td>
  <td style="${AMOUNT_STYLE}${RULE}font-size:14px;color:#111827;">${escapeHtml(line.amount)}</td>
</tr>`,
    )
    .join('\n')

  const applied = data.paymentsApplied
    ? `<tr>
  <td style="${LABEL_STYLE}font-size:14px;color:#6b7280;">Payments applied</td>
  <td style="${AMOUNT_STYLE}font-size:14px;color:#6b7280;">${escapeHtml(data.paymentsApplied)}</td>
</tr>`
    : ''

  const balanceColor = options.pastDue ? '#b42318' : '#1a3a5c'

  const payButton = data.payLink
    ? `<table cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;">
  <tr><td style="background:#2a7d70;border-radius:6px;">
    <a href="${escapeHtml(data.payLink)}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">Pay this invoice</a>
  </td></tr>
</table>`
    : ''

  const notes = data.notes
    ? `<p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#374151;">${paragraph(data.notes)}</p>`
    : ''

  const terms = data.terms
    ? `<p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#6b7280;">${paragraph(data.terms)}</p>`
    : ''

  const intro = options.intro
    ? `<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151;">${paragraph(options.intro)}</p>`
    : ''

  const matterLine = data.billTo.matterNumber
    ? `<p style="margin:4px 0 0;font-size:13px;color:#6b7280;">Matter ${escapeHtml(data.billTo.matterNumber)}</p>`
    : ''

  return `${intro}
<table width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td>
      <p style="margin:0;font-size:20px;font-weight:600;color:#1a3a5c;">Invoice ${escapeHtml(data.invoiceNumber)}</p>
      ${matterLine}
    </td>
  </tr>
</table>

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 0;">
  <tr>
    <td style="font-size:13px;color:#6b7280;padding:2px 0;">Issued</td>
    <td style="font-size:13px;color:#111827;padding:2px 0;text-align:right;">${escapeHtml(data.issueDate)}</td>
  </tr>
  <tr>
    <td style="font-size:13px;color:#6b7280;padding:2px 0;">Due</td>
    <td style="font-size:13px;color:${balanceColor};font-weight:600;padding:2px 0;text-align:right;">${escapeHtml(data.dueDate)}</td>
  </tr>
</table>

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;border-collapse:collapse;">
  <tr>
    <td style="${LABEL_STYLE}border-bottom:2px solid #1a3a5c;font-size:12px;letter-spacing:0.5px;text-transform:uppercase;color:#1a3a5c;">Description</td>
    <td style="${AMOUNT_STYLE}border-bottom:2px solid #1a3a5c;font-size:12px;letter-spacing:0.5px;text-transform:uppercase;color:#1a3a5c;">Amount</td>
  </tr>
${lines}
  <tr>
    <td style="${LABEL_STYLE}font-size:14px;color:#6b7280;">Subtotal</td>
    <td style="${AMOUNT_STYLE}font-size:14px;color:#6b7280;">${escapeHtml(data.subtotal)}</td>
  </tr>
${applied}
  <tr>
    <td style="${LABEL_STYLE}padding-top:12px;border-top:2px solid #1a3a5c;font-size:16px;font-weight:700;color:${balanceColor};">Balance due</td>
    <td style="${AMOUNT_STYLE}padding-top:12px;border-top:2px solid #1a3a5c;font-size:16px;font-weight:700;color:${balanceColor};">${escapeHtml(data.balanceDue)}</td>
  </tr>
</table>

${payButton}
${notes}
${terms}

<p style="margin:28px 0 0;font-size:12px;line-height:1.6;color:#9ca3af;">${escapeHtml(data.remitTo)}</p>`
}

/** Plain-text fallback for clients that refuse HTML. */
export function buildInvoiceEmailText(
  data: InvoiceRenderData,
  options: { intro?: string | null } = {},
): string {
  const lines = data.lines.map(line => `  ${line.description}  ${line.amount}`).join('\n')
  return [
    options.intro?.trim(),
    `Invoice ${data.invoiceNumber}`,
    data.billTo.matterNumber ? `Matter ${data.billTo.matterNumber}` : null,
    '',
    `Issued: ${data.issueDate}`,
    `Due:    ${data.dueDate}`,
    '',
    lines,
    '',
    `Subtotal:    ${data.subtotal}`,
    data.paymentsApplied ? `Payments:    ${data.paymentsApplied}` : null,
    `Balance due: ${data.balanceDue}`,
    data.payLink ? `\nPay online: ${data.payLink}` : null,
    data.notes ? `\n${data.notes}` : null,
    data.terms ? `\n${data.terms}` : null,
    '',
    data.remitTo,
  ]
    .filter(value => value !== null && value !== undefined)
    .join('\n')
}
