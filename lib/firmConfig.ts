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
