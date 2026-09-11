import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { getDocumentInclusions } from '@/lib/designSheetDocumentInclusions'

// Opt-in, disposable PostgreSQL only. Bootstrap tests/fixtures/drafting-hub-schema.sql
// and the migration, then run with VITEST_HUB_SQL_TEST_CONTAINER=cornerstone-drafting-ux-test.
const container = process.env.VITEST_HUB_SQL_TEST_CONTAINER
const configs = [
  { plan_type: 'pour_over', decisions: {} },
  { plan_type: 'outright_will', decisions: {} },
  { plan_type: 'testamentary_trust', decisions: {} },
  { plan_type: null, decisions: {} },
  { plan_type: null, decisions: { plan_track: 'college_prep', college_prep: { will_include: true, ferpa_release: true } } },
  { plan_type: 'pour_over', decisions: { plan_track: ' college_prep ' } },
]
const keys = Object.keys(getDocumentInclusions({ plan_type: null, marital_status: null, decisions: {} }))
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`

describe.skipIf(!container)('drafting hub SQL inclusion parity', () => {
  it('matches canonical inclusion defaults, every boolean combination, and malformed legacy values', () => {
    const fixtures = configs.flatMap(config => {
      const defaults = { ...config, marital_status: 'single' as const }
      return [defaults, ...Array.from({ length: 1 << keys.length }, (_, mask) => ({
        ...defaults,
        decisions: { ...config.decisions, document_inclusions: Object.fromEntries(keys.map((key, i) => [key, Boolean(mask & (1 << i))])) },
      })), ...['false', null, [], { will: 'false', trust: 0, dpoa: null }].map(value => ({
        ...defaults, decisions: { ...config.decisions, document_inclusions: value },
      }))]
    })
    const expected = fixtures.map(sheet => Object.values(getDocumentInclusions(sheet)).some(Boolean))
    const sql = `select jsonb_agg(public.drafting_hub_has_documents(plan, decisions) order by n) from (values ${fixtures.map((sheet, n) => `(${n},${sheet.plan_type === null ? 'null' : quote(sheet.plan_type)},${quote(JSON.stringify(sheet.decisions))}::jsonb)`).join(',')}) as fixtures(n,plan,decisions);`
    const result = execFileSync('docker', ['exec', '-i', container!, 'psql', '-U', 'postgres', '-d', 'hub_test', '-At', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', maxBuffer: 2_000_000 })
    expect(JSON.parse(result)).toEqual(expected)
  })
})
