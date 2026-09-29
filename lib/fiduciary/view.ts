import type { SupabaseClient } from '@supabase/supabase-js'
import type { GeneratedDatabase } from '@/types/supabase'
import {
  buildMatrix,
  matrixIssues,
  roleLabel,
  type FiduciaryRole,
  type ForParty,
  type IssueSeverity,
  type MatrixIssue,
} from './matrix'
import { loadFiduciaries } from './repository'

/**
 * The fiduciary matrix as the matter page and the firm-wide list show it.
 *
 * Read from the appointments recorded on the matter's people (`contact_roles`),
 * the same rows the fiduciary sweep turns into tasks — so a gap shown here is
 * the gap a task was opened for. Ported from the workbench's `/fiduciary`
 * pages; the analysis itself is `./matrix.ts`, unchanged.
 */

export interface FiduciaryChainView {
  /** The office, for matching against the design sheet's slots. */
  roleKey: FiduciaryRole
  role: string
  forParty: ForParty
  people: Array<{ name: string; isCoagent: boolean }>
}

export interface FiduciaryPersonView {
  name: string
  offices: string[]
}

export interface MatterFiduciaryView {
  matterId: string
  title: string
  issues: Array<Pick<MatrixIssue, 'kind' | 'severity' | 'message'>>
  chains: FiduciaryChainView[]
  people: FiduciaryPersonView[]
}

export interface FiduciaryOverviewRow {
  matterId: string
  title: string
  /** Contradictions and gaps; a note is worth knowing but is not a hole. */
  gaps: number
  notes: number
}

const isGap = (severity: IssueSeverity) => severity !== 'note'

/** One matter's matrix, whatever its status, or null when the matter does not exist. */
export async function loadMatterFiduciaryView(
  client: SupabaseClient<GeneratedDatabase>,
  matterId: string,
): Promise<MatterFiduciaryView | null> {
  const [matter] = await loadFiduciaries(client, { matterId, hiredOnly: false })
  if (!matter) return null

  const matrix = buildMatrix(matter.appointments)
  return {
    matterId: matter.matterId,
    title: matter.title,
    issues: matrixIssues(matrix, { minorChildren: matter.minorChildren }).map(({ kind, severity, message }) => ({
      kind,
      severity,
      message,
    })),
    chains: matrix.chains.map((chain) => ({
      roleKey: chain.role,
      role: roleLabel(chain.role),
      forParty: chain.forParty,
      people: chain.people.map((person) => ({ name: person.name, isCoagent: person.isCoagent })),
    })),
    people: matrix.people.map((person) => ({
      name: person.name,
      offices: [...new Set(person.appointments.map((appointment) => roleLabel(appointment.role)))],
    })),
  }
}

/**
 * Every hired matter with appointments recorded, gaps first: the list exists
 * to be worked down, not browsed.
 */
export async function loadFiduciaryOverview(client: SupabaseClient<GeneratedDatabase>): Promise<FiduciaryOverviewRow[]> {
  return (await loadFiduciaries(client))
    .filter((matter) => matter.appointments.length > 0)
    .map((matter) => {
      const issues = matrixIssues(buildMatrix(matter.appointments), { minorChildren: matter.minorChildren })
      return {
        matterId: matter.matterId,
        title: matter.title,
        gaps: issues.filter((issue) => isGap(issue.severity)).length,
        notes: issues.filter((issue) => !isGap(issue.severity)).length,
      }
    })
    .sort((a, b) => b.gaps - a.gaps || a.title.localeCompare(b.title))
}
