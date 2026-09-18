import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  matter: vi.fn(), uploads: vi.fn(), counts: vi.fn(), reads: [] as string[],
  shell: { client_intake_id: 'intake', matter_number: 'M-1' } as any,
}))
vi.mock('@/lib/queries/matterCore', () => ({ fetchMatter: mocks.matter, fetchMatterContacts: async () => [] }))
vi.mock('@/lib/queries/matterOverview', () => ({ fetchMatterAgingSummary: async () => ({}), fetchMatterEstateSnapshot: async () => ({}) }))
vi.mock('@/lib/queries/matterStageHistory', () => ({ fetchMatterStageHistory: async () => ({ entries: [] }) }))
vi.mock('@/lib/queries', () => ({ fetchDesignSheet: async () => null, fetchIntakeForMatter: async () => null }))
vi.mock('@/lib/matter/unreviewedUploads', () => ({ fetchUnreviewedUploadCounts: mocks.uploads }))
vi.mock('@/lib/queries/tasks', () => ({ fetchRecordTaskCounts: mocks.counts, fetchTasksForMatter: async () => [] }))
vi.mock('@/lib/draftPayload/resolveMatterId', () => ({ resolveMatterId: async (id: string) => id }))
vi.mock('@/lib/designSheet/seedFromIntake', () => ({ isDesignSheetUnseeded: () => true, buildIntakeResyncPreview: () => [] }))
vi.mock('@/lib/intakeReadiness', () => ({ resolveIntakeReviewFlags: () => [] }))
vi.mock('@/lib/matter/planMirror', () => ({ buildMatterPlanMirror: () => ({}) }))
vi.mock('@/lib/communications/providers', () => ({ manualCommunicationsEnabled: () => false }))
vi.mock('@/lib/communications/config', () => ({ isSmsConfigured: () => false }))
vi.mock('@/lib/esign/firma', () => ({ isEsignConfigured: () => false }))
vi.mock('@/lib/googleCalendar', () => ({ isGoogleConfigured: () => false }))
vi.mock('@/lib/leads/activity', () => ({ buildLinkedMatterActivity: () => [] }))
vi.mock('@/app/admin/matters/[id]/tabs/noteLinks', () => ({ mapMatterNoteRows: () => [] }))
vi.mock('@/app/admin/matters/[id]/MatterDetailClient', () => ({ default: () => null }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: (table: string) => {
  const result = () => {
    mocks.reads.push(table)
    return { data: table === 'matters' ? mocks.shell : table === 'client_intake' ? { id: 'intake' } : table === 'matter_details' ? null : [], error: null }
  }
  const chain: any = {
    select: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
    maybeSingle: async () => result(),
    then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject),
  }
  return chain
} }) }))
import MatterDetailPage from '@/app/admin/matters/[id]/page'

beforeEach(() => {
  vi.clearAllMocks(); mocks.reads = []
  mocks.matter.mockResolvedValue({ client_name: 'Synthetic', spouse_name: null })
  mocks.uploads.mockResolvedValue({ intake: 0, portal: 0, total: 0 })
  mocks.counts.mockResolvedValue({ open: 603, overdue: 301 })
})
const params = { params: Promise.resolve({ id: '11111111-2222-3333-4444-555555555555' }) }
it('starts intake and upload dependencies while the independent overview read is pending', async () => {
  let finish!: (value: unknown) => void
  mocks.matter.mockReturnValue(new Promise(resolve => { finish = resolve }))
  const pending = MatterDetailPage(params)
  // Flush the independent shell -> intake -> upload microtask chain.
  for (let i = 0; i < 20; i++) await Promise.resolve()
  try {
    expect(mocks.reads).toContain('client_intake')
    expect(mocks.uploads).toHaveBeenCalledTimes(1)
  } finally {
    finish({ client_name: 'Synthetic', spouse_name: null })
    await pending
  }
})
it('passes complete task badge totals to the page without downloading the task list', async () => {
  const page = await MatterDetailPage(params)
  expect(page.props.initialTaskCounts).toEqual({ open: 603, overdue: 301 })
  expect(mocks.counts).toHaveBeenCalledTimes(1)
})
it('keeps the matter page hired-only through the timing wrapper', async () => {
  await MatterDetailPage(params)
  expect(mocks.matter).toHaveBeenCalledExactlyOnceWith('11111111-2222-3333-4444-555555555555')
})
it('does not render a false all-clear when upload counts fail', async () => {
  mocks.uploads.mockRejectedValue(new Error('Uploads unavailable'))
  await expect(MatterDetailPage(params)).rejects.toThrow('Uploads unavailable')
})
