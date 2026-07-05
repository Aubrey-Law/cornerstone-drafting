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
