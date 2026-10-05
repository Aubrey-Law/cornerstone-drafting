/**
 * Optional services offered at the PMPS — the add-ons the Estate Plan Proposal
 * prints in its Optional Services table.
 *
 * Stored on `matter_details.optional_services`. `null` means "nothing recorded
 * for this matter", and the proposal falls back to the firm's standard list;
 * an empty array means "none offered", and the table is left out. Keeping the
 * two apart is the point: a client offered nothing must not be shown the
 * defaults.
 */

export const OPTIONAL_SERVICE_STATUSES = ['Recommended', 'Optional'] as const
export type OptionalServiceStatus = typeof OPTIONAL_SERVICE_STATUSES[number]

export interface OptionalService {
  service: string
  description: string
  /** Whole dollars; null when the fee has not been set. */
  fee: number | null
  status: OptionalServiceStatus
}

/**
 * The firm's standard add-ons: what a matter offers until someone records
 * otherwise. Mirrors FIRM_CONFIG.OPTIONAL_SERVICES in
 * lib/pmps/templates/pmps-proposal.js, which is now only a fallback the run
 * never reaches — the PMPS package always passes this list or the matter's own.
 */
export const FIRM_OPTIONAL_SERVICES: readonly OptionalService[] = [
  {
    service: 'Credit Shelter Estate Planning',
    description: 'Separate trusts for each spouse to preserve both Massachusetts exemptions',
    fee: 2500,
    status: 'Recommended',
  },
  {
    service: 'Real Property Transfer',
    description: 'Quitclaim deed to transfer home into trust',
    fee: 350,
    status: 'Recommended',
  },
  {
    service: 'Attorney-Supervised Signing',
    description: 'In-person signing',
    fee: 375,
    status: 'Optional',
  },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readFee(value: unknown): number | null {
  const fee = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(/[$,\s]/g, '')) : NaN
  return Number.isFinite(fee) && fee >= 0 ? fee : null
}

/**
 * Read the stored column. Rows without a service name are dropped — they are
 * blank lines an editor left behind, not services — and an unknown status
 * reads as Optional, the weaker claim.
 */
export function parseOptionalServices(value: unknown): OptionalService[] | null {
  if (!Array.isArray(value)) return null
  return value.flatMap(row => {
    if (!isRecord(row)) return []
    const service = typeof row.service === 'string' ? row.service.trim() : ''
    if (!service) return []
    return [{
      service,
      description: typeof row.description === 'string' ? row.description.trim() : '',
      fee: readFee(row.fee),
      status: row.status === 'Recommended' ? 'Recommended' : 'Optional',
    }]
  })
}

function money(value: number): string {
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

/** The row shape `lib/pmps/templates/pmps-proposal.js` renders. */
export function optionalServicesForProposal(
  services: OptionalService[],
): Array<{ name: string; description: string; fee: string; status: OptionalServiceStatus }> {
  return services.map(service => ({
    name: service.service,
    description: service.description,
    fee: service.fee === null ? '[confirm]' : money(service.fee),
    status: service.status,
  }))
}
