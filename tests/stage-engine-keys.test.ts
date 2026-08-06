import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LEAD_ENGINE_KEYS,
  MATTER_ENGINE_KEYS,
  MATTER_PIPELINE_STAGES,
  PIPELINE_TO_ENGINE,
  UNTASKED_ENGINE_KEYS,
  type MatterEngineKey,
} from '@/types/database'
import { mapMatterStageToEngine } from '@/lib/stage-engine/labels'
import { loadStageTaskTemplates } from '@/lib/stage-engine/stageTaskTemplates'
import { firesAttorneyTask } from '@/lib/stage-engine/fireStageTasks'

const MIGRATIONS = path.join(process.cwd(), 'supabase/migrations')

/**
 * The SQL function and the TypeScript map are two statements of the same
 * thing, and they drifted once. Parse the live definition — the most recent
 * migration that redefines it — and hold the two together.
 */
function sqlStageMap(): Record<string, string> {
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter(name => name.endsWith('.sql'))
    .sort()
    .reverse()

  for (const name of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, name), 'utf8')
    if (!sql.includes('function public.map_matter_stage_to_engine')) continue
    const body = sql.slice(sql.indexOf('SELECT CASE p_stage'), sql.indexOf('ELSE NULL'))
    const map: Record<string, string> = {}
    for (const match of body.matchAll(/WHEN '([a-z_]+)' THEN '([a-z_]+)'/g)) {
      map[match[1]] = match[2]
    }
    return map
  }
  throw new Error('map_matter_stage_to_engine() not found in any migration')
}

describe('engine stage keys', () => {
  const sql = sqlStageMap()

  it('maps every pipeline stage exactly as the SQL function does', () => {
    expect(Object.keys(sql).sort()).toEqual([...MATTER_PIPELINE_STAGES].sort())
    for (const [stage, engineKey] of Object.entries(sql)) {
      expect(PIPELINE_TO_ENGINE[stage as keyof typeof PIPELINE_TO_ENGINE]).toBe(engineKey)
    }
  })

  it('declares MATTER_ENGINE_KEYS as exactly the SQL function’s range', () => {
    expect([...MATTER_ENGINE_KEYS].sort()).toEqual([...new Set(Object.values(sql))].sort())
  })

  it('keeps the runtime mapper on the same table', () => {
    for (const stage of MATTER_PIPELINE_STAGES) {
      expect(mapMatterStageToEngine(stage)).toBe(PIPELINE_TO_ENGINE[stage])
    }
    expect(mapMatterStageToEngine('not_a_stage')).toBeNull()
  })

  it('keeps proposal_ea_out off the matter map — it is a lead stage', () => {
    expect(Object.values(sql)).not.toContain('proposal_ea_out')
    expect([...LEAD_ENGINE_KEYS]).toEqual(['proposal_ea_out'])
    expect(MATTER_ENGINE_KEYS as readonly string[]).not.toContain('proposal_ea_out')
  })

  it('splits design out of design_input', () => {
    expect(sql.design).toBe('design')
    expect(sql.intake).toBe('design_input')
    expect(sql.intake_review).toBe('design_input')
  })
})

describe('untasked engine keys', () => {
  const templateKeys = new Set(loadStageTaskTemplates().templates.map(t => t.stage_key))

  it('are exactly the matter engine keys with no template', () => {
    const withoutTemplate = MATTER_ENGINE_KEYS.filter(key => !templateKeys.has(key))
    expect([...withoutTemplate].sort()).toEqual([...UNTASKED_ENGINE_KEYS].sort())
  })

  it('are documented in the config so the gap reads as deliberate', () => {
    const documented = loadStageTaskTemplates().scope?.untasked_engine_keys ?? {}
    for (const key of UNTASKED_ENGINE_KEYS) {
      expect(typeof documented[key]).toBe('string')
    }
  })

  it('fire no attorney task', () => {
    for (const key of UNTASKED_ENGINE_KEYS) {
      expect(firesAttorneyTask(key)).toBe(false)
    }
    for (const key of ['design', 'drafting', 'revisions', 'signing_scheduled', 'closeout', 'funding'] as MatterEngineKey[]) {
      expect(firesAttorneyTask(key)).toBe(true)
    }
  })
})

describe('the design split migration', () => {
  const sql = fs.readFileSync(
    path.join(MIGRATIONS, '20260903000001_split_design_engine_stage.sql'),
    'utf8',
  )

  it('inserts the design stage_sla row as an attorney stage', () => {
    expect(sql).toMatch(/'design',\s*'DEFAULT',\s*'matter',\s*'attorney',\s*5,\s*2,\s*3/)
  })

  it('re-pins matters already in design so nothing flips red on deploy', () => {
    expect(sql).toMatch(/update public\.matters[\s\S]*stage_entered_at = now\(\)[\s\S]*where stage = 'design'/)
  })

  it('moves open design_input tasks onto the new key rather than duplicating them', () => {
    expect(sql).toMatch(/update public\.tasks[\s\S]*stage_key = 'design'[\s\S]*stage_key = 'design_input'/)
  })
})
