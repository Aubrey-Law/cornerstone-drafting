/**
 * The firm office, for in-person appointments.
 *
 * Firm settings (Settings → Firm) are the source when a street is set; until
 * then this is the Needham office, so the booking page, confirmation email,
 * reminders and calendar invite never fall back to a bare "our office".
 * Pure: used by the client booking card as well as the server.
 */
export const DEFAULT_OFFICE_ADDRESS = '1329 Highland Avenue, Needham, MA 02492'

export function firmOfficeAddress(firm: {
  street?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
}): string {
  const street = firm.street?.trim()
  if (!street) return DEFAULT_OFFICE_ADDRESS
  const cityState = [firm.city?.trim(), firm.state?.trim()].filter(Boolean).join(', ')
  return [street, cityState, firm.zip?.trim()].filter(Boolean).join(', ')
}
