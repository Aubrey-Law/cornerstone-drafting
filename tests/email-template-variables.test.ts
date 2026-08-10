import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { EMAIL_CATEGORIES } from '@/lib/email/categories'
import { renderEmailTemplateText } from '@/lib/email/templateShared'
import {
  MANUAL_EMAIL_VARIABLES,
  emailTemplateToken,
  emailTemplateVariables,
} from '@/lib/email/templateVariables'

describe('email template variable registry', () => {
  it('offers the intake link only where a send path resolves it', () => {
    const keysFor = (category: Parameters<typeof emailTemplateVariables>[0]) =>
      emailTemplateVariables(category).map((option) => option.key)

    expect(keysFor('intake_invite')).toContain('intake_link')
    expect(keysFor('intake_invite_college_prep')).toContain('intake_link')
    expect(keysFor('manual')).toContain('intake_link')
    // Offering it here would ship a literal {{intake_link}} to a client.
    expect(keysFor('appointment_reminder')).not.toContain('intake_link')
  })

  it('always offers the recipient name variables', () => {
    for (const category of EMAIL_CATEGORIES) {
      const keys = emailTemplateVariables(category).map((option) => option.key)
      expect(keys).toContain('first_name')
      expect(keys).toContain('client_name')
    }
  })

  it('uses snake_case keys throughout', () => {
    for (const option of MANUAL_EMAIL_VARIABLES) {
      expect(option.key).toMatch(/^[a-z][a-z0-9_]*$/)
      expect(option.label.trim().length).toBeGreaterThan(0)
      expect(option.hint.trim().length).toBeGreaterThan(0)
    }
  })

  it('emits tokens the renderer actually substitutes', () => {
    for (const option of MANUAL_EMAIL_VARIABLES) {
      const token = emailTemplateToken(option.key)
      const rendered = renderEmailTemplateText(`Hi ${token},`, { [option.key]: 'Rowan' })
      expect(rendered).toBe('Hi Rowan,')
    }
  })
})

describe('template builder wiring', () => {
  const section = fs.readFileSync(
    path.join(process.cwd(), 'app/admin/settings/EmailTemplatesSection.tsx'),
    'utf8',
  )

  it('hands the variable list to both the subject and the body', () => {
    expect(section).toContain('variableOptions={variableOptions}')
    expect(section).toContain('Insert subject variable')
    expect(section).toContain('emailTemplateVariables(form.category)')
  })

  it('does not hardcode a variable list that could drift from the registry', () => {
    expect(section).not.toContain("Intake invitations support")
  })
})
