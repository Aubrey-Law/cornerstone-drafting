/**
 * Whether an address belongs to the firm.
 *
 * A security boundary, not a formatting helper: everything this lets through
 * gets an attorney's view of every matter. So the match is exact — the address
 * must end in `@aubreylegal.com` and nothing else. `@aubreylegal.com.evil.example`
 * and `@sub.aubreylegal.com` are both rejected, because both would otherwise
 * be registrable by someone who is not the firm.
 */
export const FIRM_EMAIL_DOMAIN = 'aubreylegal.com'

export function isFirmEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const at = email.lastIndexOf('@')
  if (at <= 0) return false
  // No trimming. Whitespace means this disagrees with whatever stored the
  // address, and anything that odd is not a firm login.
  return email.slice(at + 1).toLowerCase() === FIRM_EMAIL_DOMAIN
}
