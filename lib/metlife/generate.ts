import generateMetlifeClaim from '@/lib/metlife/templates/metlife-claim'
import { formatFee } from '@/lib/metlife/pricing'
import { METLIFE_PLAN_TYPE_LABEL, type MetlifeArtifact, type MetlifeClaimData, type MetlifeSubmissionRow } from '@/lib/metlife/types'

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as const

type TemplateGenerator = (data: Record<string, unknown>) => Promise<Buffer>

function displayDate(value: string) {
  const parsed = new Date(`${value}T12:00:00`)
  return Number.isNaN(parsed.valueOf())
    ? value
    : new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'America/New_York' }).format(parsed)
}

/**
 * The Portal Submission Table: one numbered row per line item, numbered
 * sequentially across every section rather than restarting per section, because
 * the portal takes one submission per row.
 */
export function buildSubmissionRows(data: MetlifeClaimData): MetlifeSubmissionRow[] {
  const rows: MetlifeSubmissionRow[] = []
  for (const section of data.sections) {
    for (const item of section.items) {
      rows.push({
        index: rows.length + 1,
        document: item.document,
        serviceCode: item.serviceCode,
        serviceType: item.serviceType,
        fee: formatFee(item.feeCents),
        comment: item.comment,
        complete: 'Yes',
      })
    }
  }
  return rows
}

export function metlifeClaimFilename(data: MetlifeClaimData) {
  return `${data.filePrefix}_MetLife_Claim_${data.dateSubmitted}.docx`
}

export function submissionCsv(rows: MetlifeSubmissionRow[]) {
  const escape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`
  const header = ['#', 'Document', 'Service Type', 'Fee', 'Comment', 'Complete']
  return [
    header.map(escape).join(','),
    ...rows.map(row => [row.index, row.document, row.serviceType, row.fee, row.comment, row.complete].map(escape).join(',')),
  ].join('\n')
}

export async function generateMetlifeArtifact(data: MetlifeClaimData): Promise<MetlifeArtifact> {
  const submissionRows = buildSubmissionRows(data)
  const bytes = await (generateMetlifeClaim as unknown as TemplateGenerator)({
    planTypeLabel: METLIFE_PLAN_TYPE_LABEL[data.planType],
    memberId: data.memberId,
    memberName: data.memberName,
    spouseName: data.spouseName,
    matterNumber: data.matterNumber,
    serviceStart: displayDate(data.serviceStart),
    serviceEnd: displayDate(data.serviceEnd),
    dateSubmitted: displayDate(data.dateSubmitted),
    grandTotal: formatFee(data.grandTotalCents),
    sections: data.sections.map(section => ({
      title: section.title,
      total: formatFee(section.totalCents),
      items: section.items.map(item => ({
        document: item.document,
        serviceType: item.serviceType,
        fee: formatFee(item.feeCents),
        comment: item.comment,
      })),
    })),
    submissionRows,
  })
  return { kind: 'metlife_claim', filename: metlifeClaimFilename(data), contentType: DOCX, bytes }
}
