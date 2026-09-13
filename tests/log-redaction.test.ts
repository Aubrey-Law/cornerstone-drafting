import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { describeValue, redactIdentifier, redactRecipients } from '@/lib/log/redact'

describe('redactIdentifier', () => {
  it('is stable for the same address so log lines can be correlated', () => {
    expect(redactIdentifier('client@example.com')).toBe(redactIdentifier('client@example.com'))
  })

  it('ignores case and surrounding whitespace', () => {
    expect(redactIdentifier('  Client@Example.com ')).toBe(redactIdentifier('client@example.com'))
  })

  it('does not disclose the address', () => {
    const tag = redactIdentifier('client@example.com')
    expect(tag).not.toContain('client')
    expect(tag).not.toContain('example.com')
    expect(tag).toMatch(/^sha256:[0-9a-f]{12}$/)
  })

  it('distinguishes different addresses', () => {
    expect(redactIdentifier('a@example.com')).not.toBe(redactIdentifier('b@example.com'))
  })

  it('reports absence rather than hashing nothing', () => {
    expect(redactIdentifier(null)).toBe('none')
    expect(redactIdentifier(undefined)).toBe('none')
    expect(redactIdentifier('   ')).toBe('none')
  })
})

describe('redactRecipients', () => {
  it('keeps the count and a tag per recipient', () => {
    const out = redactRecipients(['a@example.com', 'b@example.com'])
    expect(out.startsWith('2:')).toBe(true)
    expect(out).not.toContain('example.com')
  })

  it('reports an empty list as none', () => {
    expect(redactRecipients([])).toBe('none')
    expect(redactRecipients(null)).toBe('none')
  })
})

describe('describeValue', () => {
  it('reports shape without content', () => {
    expect(describeValue('Rosalind Whitfield')).toBe('string(len=18)')
    expect(describeValue(42)).toBe('number')
    expect(describeValue(null)).toBe('null')
    expect(describeValue(undefined)).toBe('undefined')
    expect(describeValue(['a', 'b'])).toBe('array(len=2)')
    expect(describeValue({ a: 1, b: 2 })).toBe('object(keys=2)')
  })

  it('never echoes the value itself', () => {
    expect(describeValue('12-3456789')).not.toContain('3456789')
  })
})

/**
 * The earlier grep-based sweep of these files reported them clean because it
 * looked for identifiers inside the call parentheses, and every one of these
 * sites passes a variable instead. These assertions pin the specific call sites
 * that were confirmed by reading.
 */
describe('confirmed PII log sites stay redacted', () => {
  const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8')

  /** Just the lines that log, so ordinary uses of a variable are not flagged. */
  const consoleLines = (source: string) =>
    source.split('\n').filter(line => /console\.\w+\(/.test(line))

  it('does not log an email recipient or subject when the send is skipped', () => {
    const source = read('lib/email/send.ts')
    expect(source).toContain('to: redactIdentifier(actualTo)')
    expect(source).not.toContain('      to: actualTo,\n      subject: finalSubject,')
  })

  it('does not log an attendee email when booking reconciliation fails', () => {
    const source = read('lib/bookings/sync.ts')
    expect(source).not.toMatch(/console\.error\([^)]*`, attendeeEmail,/)
    expect(source.match(/redactIdentifier\(attendeeEmail\)/g)?.length).toBe(2)
  })

  it('does not log the value written to a matter-detail field', () => {
    const source = read('app/api/admin/matter-details/route.ts')
    // Only the console lines — line 135 destructures `value` from the request
    // body, which is not a disclosure.
    for (const line of consoleLines(source)) {
      expect(line, line.trim()).not.toMatch(/[,{]\s*value\s*[,}]/)
    }
    expect(source.match(/value: describeValue\(value\)/g)?.length).toBe(3)
  })

  it('keeps raw client identifiers out of server console arguments', () => {
    const tracked = execFileSync('git', ['ls-files', 'lib/**/*.ts', 'app/api/**/*.ts'], {
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean)
      // A file deleted but not yet staged is still listed by git; it cannot
      // contain an offending log line, so skip it rather than fail on ENOENT.
      .filter(file => existsSync(path.join(process.cwd(), file)))

    // Bare `attendeeEmail` / `actualTo` as a console argument is the exact
    // shape that reached production. Redaction wrappers are stripped first so
    // `redactIdentifier(attendeeEmail)` is not mistaken for a bare argument.
    const offenders = tracked.filter(file =>
      consoleLines(read(file))
        .map(line => line.replace(/(?:redactIdentifier|redactRecipients|describeValue)\([^)]*\)/g, 'REDACTED'))
        .some(line => /(?<![\w.])(attendeeEmail|actualTo|attendeePhone)(?![\w.])/.test(line)),
    )

    expect(offenders).toEqual([])
  })
})
