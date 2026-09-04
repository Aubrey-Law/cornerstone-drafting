import { designTargetForMissingField } from '@/lib/estateGenerator/missingFieldDesignMap'
import type { ShareCheck } from '@/lib/documents/shareGate'

/**
 * Turns the share gate's per-document verdicts into a worklist.
 *
 * The gate refuses one document at a time, at the moment of sharing. That is the
 * right place for it and the wrong place to *learn* from: an attorney meets each
 * refusal alone, mid-send, with no sense of whether it is one stray blank or a
 * single design-sheet field missing across thirty drafts. This aggregates the
 * same verdicts into the question actually worth answering — **which fields, and
 * where do I fill them in?**
 *
 * Nothing here re-implements the scan. The verdicts come from
 * `checkDocumentShareable`, so the worklist and the gate cannot drift apart; a
 * document that appears here is one that would genuinely be refused.
 */

export interface SweptDocument {
  id: string
  name: string
  matterId: string
  matterLabel: string | null
  sharedAt: string | null
  supersededAt: string | null
  check: ShareCheck
}

/** A blank field, with the count of drafts waiting on it and where to fill it. */
export interface FieldTally {
  path: string
  label: string
  sectionId: string
  sectionLabel: string
  targetField: string | null
  documentCount: number
  matterCount: number
}

export interface MatterGroup {
  matterId: string
  matterLabel: string | null
  documents: Array<{ id: string; name: string; missingFields: string[]; sharedAt: string | null }>
}

export interface SweepReport {
  scanned: number
  shareable: number
  /**
   * Blocked **and already with the client**. This is the only category that is an
   * incident rather than a chore: the gate arrived after the document went out,
   * so a blank is sitting in the portal right now.
   */
  shared: SweptDocument[]
  /** Blocked, live, not yet shared — the worklist. */
  actionable: SweptDocument[]
  /** Blocked but superseded by a later draft. Reported, never counted: fixing a
   * replaced document is work with no client on the other end of it. */
  superseded: SweptDocument[]
  /** Could not be read or opened, so the gate would refuse them on those grounds. */
  unverifiable: SweptDocument[]
  /** Across `shared` + `actionable`, most-blocking field first. */
  fields: FieldTally[]
  matters: MatterGroup[]
}

function missingFieldsOf(doc: SweptDocument): string[] {
  if (doc.check.shareable) return []
  if (doc.check.reason !== 'missing_fields') return []
  return doc.check.missingFields
}

export function summarizeSweep(documents: SweptDocument[]): SweepReport {
  const shareable = documents.filter(d => d.check.shareable)
  const unverifiable = documents.filter(
    d => !d.check.shareable && d.check.reason === 'unverifiable',
  )
  const blocked = documents.filter(
    d => !d.check.shareable && d.check.reason === 'missing_fields',
  )

  // A shared document is counted as shared even when superseded: the client can
  // still open it, so the later draft does not undo the exposure.
  const shared = blocked.filter(d => d.sharedAt !== null)
  const unshared = blocked.filter(d => d.sharedAt === null)
  const superseded = unshared.filter(d => d.supersededAt !== null)
  const actionable = unshared.filter(d => d.supersededAt === null)

  const counted = [...shared, ...actionable]

  const byPath = new Map<string, { documents: number; matters: Set<string> }>()
  for (const doc of counted) {
    for (const path of missingFieldsOf(doc)) {
      const entry = byPath.get(path) ?? { documents: 0, matters: new Set<string>() }
      entry.documents += 1
      entry.matters.add(doc.matterId)
      byPath.set(path, entry)
    }
  }

  const fields: FieldTally[] = [...byPath.entries()]
    .map(([path, entry]) => {
      const target = designTargetForMissingField(path)
      return {
        path,
        label: target.label,
        sectionId: target.sectionId,
        sectionLabel: target.sectionLabel,
        targetField: target.targetField,
        documentCount: entry.documents,
        matterCount: entry.matters.size,
      }
    })
    // Most drafts unblocked per field filled, then widest across matters, then
    // by path so a rerun with no data change prints the same report.
    .sort(
      (a, b) =>
        b.documentCount - a.documentCount ||
        b.matterCount - a.matterCount ||
        a.path.localeCompare(b.path),
    )

  const matterOrder: string[] = []
  const byMatter = new Map<string, MatterGroup>()
  for (const doc of counted) {
    let group = byMatter.get(doc.matterId)
    if (!group) {
      group = { matterId: doc.matterId, matterLabel: doc.matterLabel, documents: [] }
      byMatter.set(doc.matterId, group)
      matterOrder.push(doc.matterId)
    }
    group.documents.push({
      id: doc.id,
      name: doc.name,
      missingFields: missingFieldsOf(doc),
      sharedAt: doc.sharedAt,
    })
  }
  for (const group of byMatter.values()) {
    group.documents.sort((a, b) => a.name.localeCompare(b.name))
  }
  const matters = matterOrder
    .map(id => byMatter.get(id)!)
    .sort(
      (a, b) =>
        b.documents.length - a.documents.length ||
        (a.matterLabel ?? a.matterId).localeCompare(b.matterLabel ?? b.matterId),
    )

  return {
    scanned: documents.length,
    shareable: shareable.length,
    shared,
    actionable,
    superseded,
    unverifiable,
    fields,
    matters,
  }
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

function matterHeading(group: MatterGroup): string {
  return group.matterLabel ?? group.matterId
}

/**
 * The report a person reads.
 *
 * Ordered by what it costs to ignore: a blank already sitting in a client's
 * portal first, then the fields that unblock the most drafts, then the per-matter
 * detail. Superseded and unreadable documents come last because neither is work
 * on a client's critical path.
 */
export function formatSweepReport(report: SweepReport): string {
  const out: string[] = []
  const blockedCount = report.shared.length + report.actionable.length

  out.push(
    `Scanned ${plural(report.scanned, 'document')}: ` +
      `${report.shareable} shareable, ${blockedCount} blocked on unfilled fields.`,
  )

  if (report.shared.length > 0) {
    out.push('')
    out.push(`ALREADY WITH THE CLIENT — ${plural(report.shared.length, 'document')}`)
    out.push(
      'These were shared before the gate existed. The client can open them now,',
    )
    out.push('so they are the ones to deal with first.')
    for (const doc of report.shared) {
      out.push(`  ${doc.name}  (${doc.matterLabel ?? doc.matterId})`)
      for (const field of missingFieldsOf(doc)) out.push(`      ${field}`)
    }
  }

  if (report.fields.length > 0) {
    out.push('')
    out.push('FIELDS TO FILL, most-blocking first')
    out.push('Fill these on the design sheet and regenerate; one field often')
    out.push('unblocks several drafts at once.')
    out.push('')
    for (const field of report.fields) {
      const reach =
        field.matterCount > 1
          ? `${plural(field.documentCount, 'draft')} across ${plural(field.matterCount, 'matter')}`
          : plural(field.documentCount, 'draft')
      out.push(`  ${field.label}  —  ${reach}`)
      out.push(`      ${field.sectionLabel}${field.targetField ? '' : ' (no single field; open the section)'}`)
      out.push(`      ${field.path}`)
    }
  }

  if (report.matters.length > 0) {
    out.push('')
    out.push('BY MATTER')
    for (const group of report.matters) {
      out.push('')
      out.push(`  ${matterHeading(group)} — ${plural(group.documents.length, 'draft')}`)
      for (const doc of group.documents) {
        const shared = doc.sharedAt ? '  [SHARED]' : ''
        out.push(`      ${doc.name}${shared}`)
        out.push(`          ${plural(doc.missingFields.length, 'blank')}: ${doc.missingFields.join(', ')}`)
      }
    }
  }

  if (report.unverifiable.length > 0) {
    out.push('')
    out.push(`COULD NOT BE CHECKED — ${plural(report.unverifiable.length, 'document')}`)
    out.push('The gate refuses these too, on the grounds that it cannot tell.')
    for (const doc of report.unverifiable) {
      const detail =
        !doc.check.shareable && doc.check.reason === 'unverifiable' ? doc.check.detail : ''
      out.push(`  ${doc.name}  (${doc.matterLabel ?? doc.matterId})`)
      if (detail) out.push(`      ${detail}`)
    }
  }

  if (report.superseded.length > 0) {
    out.push('')
    out.push(
      `Also ${plural(report.superseded.length, 'superseded draft')} with blanks, not counted above — ` +
        'each has been replaced by a later version, so there is nothing to fix.',
    )
  }

  if (blockedCount === 0 && report.unverifiable.length === 0) {
    out.push('')
    out.push('Nothing is blocked. Every document checked would share cleanly.')
  }

  return out.join('\n')
}
