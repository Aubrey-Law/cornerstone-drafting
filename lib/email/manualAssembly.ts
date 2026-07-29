import 'server-only'

import { loadFirmSettings } from '@/lib/firmSettings'
import { isFullEmailDocument, wrapEmailWithBrand } from './brandWrapper'
import { emailTemplateHtmlToText, sanitizeEmailHtml, textToEmailHtml } from './templateShared'

export interface ManualEmailAssemblyInput {
  html?: string
  text?: string
  includeSignature?: boolean
}

export interface ManualEmailAssembly {
  html: string
  text: string
  signatureIncluded: boolean
}

export async function assembleManualEmail(input: ManualEmailAssemblyInput): Promise<ManualEmailAssembly> {
  const firm = await loadFirmSettings()
  const authoredHtml = sanitizeEmailHtml(input.html ?? '').trim()
  const authoredText = (input.text ?? '').trim() || emailTemplateHtmlToText(authoredHtml)
  let html = authoredHtml || textToEmailHtml(authoredText)
  let text = authoredText
  const signature = sanitizeEmailHtml(firm.emailSignatureHtml).trim()
  const signatureIncluded = input.includeSignature === true && Boolean(signature)

  if (signatureIncluded) {
    html = `${html}<div data-email-signature="true" style="margin-top:24px">${signature}</div>`
    const signatureText = emailTemplateHtmlToText(signature)
    if (signatureText) text = `${text}\n\n${signatureText}`.trim()
  }

  if (html && !isFullEmailDocument(html) && firm.emailLogoHeader) {
    html = wrapEmailWithBrand(html, {
      firmName: firm.firmName,
      email: firm.email,
      city: firm.city,
    })
  }

  return { html, text, signatureIncluded }
}
