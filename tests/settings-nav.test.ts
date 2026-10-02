import { describe, expect, it } from 'vitest'
import { resolveSettingsTab, SETTINGS_NAV, settingsNavFor } from '@/app/admin/settings/settingsNav'

describe('settings side menu', () => {
  it('hides administrator-only entries from attorneys', () => {
    const labels = (admin: boolean) => settingsNavFor(admin).flatMap(g => g.items.map(i => i.label))
    expect(labels(true)).toContain('Templates')
    expect(labels(false)).not.toContain('Templates')
  })

  it('falls back to Models for unknown or forbidden tabs', () => {
    expect(resolveSettingsTab('email', false)).toBe('email')
    expect(resolveSettingsTab('templates', true)).toBe('templates')
    expect(resolveSettingsTab('templates', false)).toBe('models')
    expect(resolveSettingsTab('nope', true)).toBe('models')
    expect(resolveSettingsTab(null, true)).toBe('models')
  })

  it('lists every entry once', () => {
    const keys = SETTINGS_NAV.flatMap(g => g.items.map(i => (i.kind === 'tab' ? i.tab : i.href)))
    expect(new Set(keys).size).toBe(keys.length)
  })
})
