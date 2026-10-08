import { describe, expect, it } from 'vitest'
import { resolveSettingsTab, SETTINGS_NAV, settingsNavFor } from '@/app/admin/settings/settingsNav'

describe('settings side menu', () => {
  it('shows Intake forms only to administrators without hiding shared workflow settings', () => {
    const adminWorkflow = settingsNavFor(true).find(group => group.label === 'Workflow')!
    expect(adminWorkflow.items).toContainEqual(expect.objectContaining({ kind: 'route', href: '/admin/settings/intake-forms', label: 'Intake forms' }))
    const staffWorkflow = settingsNavFor(false).find(group => group.label === 'Workflow')!
    expect(staffWorkflow.items.map(item => item.label)).not.toContain('Intake forms')
    expect(staffWorkflow.items.map(item => item.label)).toContain('Stage SLA')
    expect(staffWorkflow.items.map(item => item.label)).toContain('Command center')
  })

  it('no longer lists Templates, which moved to the Library', () => {
    const labels = settingsNavFor(true).flatMap(g => g.items.map(i => i.label))
    expect(labels).not.toContain('Templates')
  })

  it('falls back to Models for unknown or forbidden tabs', () => {
    expect(resolveSettingsTab('email', false)).toBe('email')
    expect(resolveSettingsTab('templates', true)).toBe('models')
    expect(resolveSettingsTab('nope', true)).toBe('models')
    expect(resolveSettingsTab(null, true)).toBe('models')
  })

  it('lists every entry once', () => {
    const keys = SETTINGS_NAV.flatMap(g => g.items.map(i => (i.kind === 'tab' ? i.tab : i.href)))
    expect(new Set(keys).size).toBe(keys.length)
  })
})
