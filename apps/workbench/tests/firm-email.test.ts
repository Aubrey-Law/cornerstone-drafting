import { describe, expect, it } from 'vitest'
import { FIRM_EMAIL_DOMAIN, isFirmEmail } from '@/lib/auth/firmEmail'

/**
 * The Workbench's Google sign-in is restricted to firm addresses, so this
 * predicate is a security boundary rather than a formatting helper. Everything
 * it lets through gets an attorney's view of every matter.
 */
describe('isFirmEmail', () => {
  it('accepts a firm address', () => {
    expect(isFirmEmail(`scott@${FIRM_EMAIL_DOMAIN}`)).toBe(true)
  })

  it('ignores case, since an email domain is case-insensitive', () => {
    expect(isFirmEmail('Scott@AubreyLegal.COM')).toBe(true)
  })

  it.each([
    ['scott@gmail.com', 'another domain'],
    ['scott@aubreylegal.com.evil.example', 'the firm domain as a prefix of another'],
    ['scott@notaubreylegal.com', 'the firm domain as a suffix of another'],
    ['scott@sub.aubreylegal.com', 'a subdomain, which the firm does not use'],
    ['aubreylegal.com', 'no local part at all'],
    ['', 'empty'],
  ])('rejects %s (%s)', (email) => {
    expect(isFirmEmail(email)).toBe(false)
  })

  it.each([null, undefined])('rejects %s', (email) => {
    expect(isFirmEmail(email)).toBe(false)
  })

  it('rejects an address with trailing whitespace rather than trimming it', () => {
    // Trimming here would mean this predicate disagrees with whatever stored
    // the address. Anything odd enough to have whitespace is not a firm login.
    expect(isFirmEmail(`scott@${FIRM_EMAIL_DOMAIN} `)).toBe(false)
  })
})
