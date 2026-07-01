import { formatPhoneDisplay } from '@/lib/phone'

export interface FirmConfig {
  attorneyName: string
  attorneyShortName: string
  firmName: string
  city: string
  email: string
  phone: string
}

export function getFirmConfig(): FirmConfig {
  return {
    attorneyName: process.env.NEXT_PUBLIC_FIRM_ATTORNEY_NAME ?? 'Scott Aubrey, Esq.',
    attorneyShortName: process.env.NEXT_PUBLIC_FIRM_ATTORNEY_SHORT_NAME ?? 'Scott Aubrey',
    firmName: process.env.NEXT_PUBLIC_FIRM_NAME ?? 'Aubrey Law',
    city: process.env.NEXT_PUBLIC_FIRM_CITY ?? 'Needham, MA',
    email: process.env.NEXT_PUBLIC_FIRM_EMAIL ?? 'scott@aubreylegal.com',
    phone: formatPhoneDisplay(process.env.NEXT_PUBLIC_FIRM_PHONE ?? '(781) 474-3450'),
  }
}

/**
 * Returns the Resend-verified "from" address for outgoing email.
 * Set RESEND_FROM to override the default (e.g. when using a subdomain like
 * "Scott Aubrey <noreply@mg.aubreylegal.com>" that's separately verified in Resend).
 */
export function getResendFrom(): string {
  if (process.env.RESEND_FROM) return process.env.RESEND_FROM
  const { attorneyShortName, email } = getFirmConfig()
  return `${attorneyShortName} <${email}>`
}


function attorneyInitials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || 'AT'
}

export function getFirmAttorneyInitials(): string {
  return attorneyInitials(getFirmConfig().attorneyShortName)
}

export function buildFirmSignatureHtml(
  firm: { attorneyName: string; firmName: string; city: string; email: string; phone: string },
  { includeCity = true, includePhone = true }: { includeCity?: boolean; includePhone?: boolean } = {},
): string {
  const line1 = [firm.attorneyName, firm.firmName, includeCity ? firm.city : null].filter(Boolean).join(' · ')
  const line2 = [
    `<a href="mailto:${firm.email}" style="color:#1A6B72">${firm.email}</a>`,
    includePhone ? firm.phone : null,
  ].filter(Boolean).join(' · ')
  return `<p style="font-size:12px;color:#6B6860">${line1}<br/>${line2}</p>`
}

export function firmEmailSignatureHtml(opts: { includeCity?: boolean; includePhone?: boolean } = {}): string {
  return buildFirmSignatureHtml(getFirmConfig(), opts)
}

export function customEmail({
  heading,
  body,
  ctaLabel,
  ctaUrl,
}: {
  heading: string
  body: string
  ctaLabel?: string
  ctaUrl?: string
}): string {
  const cta =
    ctaLabel && ctaUrl
      ? `<div style="margin:28px 0 0">
           <a href="${ctaUrl}" style="display:inline-block;background:#0d9488;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:600">${ctaLabel}</a>
         </div>`
      : ''

  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:40px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)">
        <tr>
          <td style="padding:32px">
            <h2 style="margin:0 0 16px;font-size:20px;color:#1a1917">${heading}</h2>
            <div style="font-size:15px;line-height:1.6;color:#44403c;white-space:pre-line">${body}</div>
            ${cta}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px 28px;border-top:1px solid #e7e5e4">
            <p style="margin:0;font-size:12px;color:#78716c;text-align:center">
              Aubrey Law · Secure Client Portal<br />
              Need help? Call (617) 555-0192
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}
