import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  prepareDesignSheetForSave,
  resolveInitialDesignSheet,
  writeDesignSheetDraft,
  clearDesignSheetDraft,
  readDesignSheetDraft,
} from '@/lib/designSheet/designSheetDraft'
import {
  getDocumentInclusions,
  mergeDecisionUpdates,
  setDocumentInclusion,
  setEstatePlanDesignSetup,
} from '@/lib/designSheetDocumentInclusions'
import { inflateDesignSheetRow } from '@/lib/designSheetPersistence'
import type { DesignSheet } from '@/types/database'

describe('design sheet draft + save preparation', () => {
  const matterId = 'matter-draft-1'

  beforeEach(() => {
    clearDesignSheetDraft(matterId)
  })

  afterEach(() => {
    clearDesignSheetDraft(matterId)
  })

  it('prepareDesignSheetForSave keeps trust inclusion from decisions', () => {
    const loaded = inflateDesignSheetRow({
      id: 'sheet-1',
      matter_id: matterId,
      plan_type: 'outright_will',
      decisions: {
        document_inclusions: { trust: false, will: true, dpoa: true, healthcare: true },
      },
    })!

    const decisions = mergeDecisionUpdates(
      { decisions: loaded.decisions },
      current => setDocumentInclusion(current, 'trust', true),
      current => setEstatePlanDesignSetup(current, { trust: true, will_title: 'pour_over_will' }),
    )
    const local = {
      ...loaded,
      decisions,
      // Legacy stale mirror that used to overwrite saves:
      document_inclusions: { trust: false, will: true, dpoa: true, healthcare: true },
    } as DesignSheet

    const prepared = prepareDesignSheetForSave(local)
    expect(getDocumentInclusions({
      plan_type: 'outright_will',
      marital_status: null,
      decisions: prepared.decisions as Record<string, unknown>,
    }).trust).toBe(true)
  })

  it('restores a session draft instead of stale server props', () => {
    const serverSheet = inflateDesignSheetRow({
      id: 'sheet-1',
      matter_id: matterId,
      plan_type: 'outright_will',
      updated_at: '2026-07-10T20:00:00.000Z',
      decisions: {
        document_inclusions: { trust: false, will: true, dpoa: true, healthcare: true },
      },
    })!

    const local = {
      ...serverSheet,
      decisions: mergeDecisionUpdates(
        { decisions: serverSheet.decisions },
        current => setDocumentInclusion(current, 'trust', true),
      ),
    } as DesignSheet

    writeDesignSheetDraft({
      matterId,
      sheet: local,
      baseUpdatedAt: '2026-07-10T20:00:00.000Z',
    })

    expect(readDesignSheetDraft(matterId)?.sheet).toBeTruthy()

    const resolved = resolveInitialDesignSheet({
      matterId,
      sheetProp: serverSheet,
      buildFromProps: () => serverSheet,
    })

    expect(getDocumentInclusions({
      plan_type: 'outright_will',
      marital_status: null,
      decisions: resolved.decisions ?? {},
    }).trust).toBe(true)
  })

  it('drops a draft when server props are newer than the draft base', () => {
    const older = inflateDesignSheetRow({
      id: 'sheet-1',
      matter_id: matterId,
      updated_at: '2026-07-10T20:00:00.000Z',
      decisions: { document_inclusions: { trust: true } },
    })!

    writeDesignSheetDraft({
      matterId,
      sheet: older,
      baseUpdatedAt: '2026-07-10T20:00:00.000Z',
    })

    const newerProps = inflateDesignSheetRow({
      id: 'sheet-1',
      matter_id: matterId,
      updated_at: '2026-07-10T21:00:00.000Z',
      decisions: { document_inclusions: { trust: false } },
    })!

    const resolved = resolveInitialDesignSheet({
      matterId,
      sheetProp: newerProps,
      buildFromProps: () => newerProps!,
    })

    expect(getDocumentInclusions({
      plan_type: null,
      marital_status: null,
      decisions: resolved.decisions ?? {},
    }).trust).toBe(false)
    expect(readDesignSheetDraft(matterId)).toBeNull()
  })
})
