import { NextRequest } from 'next/server'
import PizZip from 'pizzip'
import { beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn(), access: vi.fn(), version: vi.fn(), template: vi.fn(), read: vi.fn() }))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin: state.auth }))
vi.mock('@/lib/intake/loadAdminIntakeRow', () => ({ loadAdminIntakeRow: state.load }))
vi.mock('@/lib/intake/resolveIntakeUploadAccess', () => ({ resolveIntakeUploadAccess: state.access }))
vi.mock('@/lib/intakeContactHydration', () => ({ hydrateIntakeWithContacts: async (_admin: unknown, row: unknown) => row }))
vi.mock('@/lib/intake/forms/repository', () => ({ getVersionRow: state.version, getTemplateRow: state.template }))
import { GET as adminGet } from '@/app/api/admin/intake/[intakeId]/export/route'
import { GET as clientGet } from '@/app/api/intake/[intakeId]/export/route'

const definition = { schemaVersion: 1, key: 'custom', title: 'Published questionnaire', sections: [
  { id: 'identity', title: 'Custom identity', audience: 'client_and_staff', items: [{ kind: 'field', id: 'first', fieldId: 'client_first_name', labelOverride: 'Your given name' }] },
  { id: 'private', title: 'Staff-only decisions', audience: 'staff_only', items: [{ kind: 'block', id: 'plan', blockId: 'attorney_plan_structure' }] },
  { id: 'review', title: 'Review', audience: 'client_and_staff', items: [{ kind: 'block', id: 'submit', blockId: 'review_submit' }] },
] }
const row = { id: 'intake', form_version_id: 'version', intake_track: 'estate', first_name: 'Jordan', plan_type: 'will_based' }
const params = { params: Promise.resolve({ intakeId: 'intake' }) }
const request = () => new NextRequest('http://localhost/api/intake/intake/export?form_version_id=attacker')
async function xml(response: Response) { return new PizZip(await response.arrayBuffer()).file('word/document.xml')!.asText() }
beforeEach(() => {
  vi.clearAllMocks()
  state.auth.mockResolvedValue({ err: null })
  state.load.mockResolvedValue(row)
  state.read.mockResolvedValue({ data: row, error: null })
  state.access.mockResolvedValue({ ok: true, admin: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: state.read }) }) }) } })
  state.version.mockResolvedValue({ template_id: 'template', status: 'retired', definition })
  state.template.mockResolvedValue({ key: 'custom', archived_at: '2026-10-09' })
})
it.each(['staff', 'client'])('exports the exact retired pin for authorized %s, with audience filtering', async audience => {
  const response = await (audience === 'staff' ? adminGet : clientGet)(request(), params)
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  const body = await xml(response)
  expect(body).toContain('Published questionnaire')
  expect(body).toContain('Your given name')
  expect(body).toContain('Jordan')
  expect(body.includes('Staff-only decisions')).toBe(audience === 'staff')
  expect(state.version).toHaveBeenCalledWith('version')
})
it.each(['staff', 'client'])('fails closed without leaking database details for %s', async audience => {
  state.version.mockRejectedValue(new Error('private database details'))
  const response = await (audience === 'staff' ? adminGet : clientGet)(request(), params)
  expect(response.status).toBe(503)
  expect(await response.text()).not.toContain('private database details')
})
it.each(['staff', 'client'])('authorizes %s before reading questionnaire data', async audience => {
  state.auth.mockResolvedValue({ err: new Response('Forbidden', { status: 403 }) })
  state.access.mockResolvedValue({ ok: false, error: 'Forbidden', status: 403 })
  const response = await (audience === 'staff' ? adminGet : clientGet)(request(), params)
  expect(response.status).toBe(403)
  expect(state.load).not.toHaveBeenCalled()
  expect(state.read).not.toHaveBeenCalled()
  expect(state.version).not.toHaveBeenCalled()
})
it.each(['staff', 'client'])('retains legacy unpinned %s downloads without version reads', async audience => {
  state.load.mockResolvedValue({ ...row, form_version_id: null })
  state.read.mockResolvedValue({ data: { ...row, form_version_id: null }, error: null })
  const response = await (audience === 'staff' ? adminGet : clientGet)(request(), params)
  expect(response.status).toBe(200)
  expect(state.version).not.toHaveBeenCalled()
})
