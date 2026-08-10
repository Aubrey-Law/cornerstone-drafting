/**
 * Which question set the Guided Interview serves for a given intake.
 *
 * `estate` is the long-standing estate-planning questionnaire and stays the
 * default for every existing row. `college_prep` is the College Preparation
 * Plan questionnaire: a student turning 18 signing a durable power of
 * attorney, health care proxy, HIPAA authorization, and living will.
 *
 * Stored on `client_intake.intake_track`. The track selects the step list
 * (see `getActiveSteps`), so it must be resolved from the intake row rather
 * than passed around — every caller already has the row.
 */
export type IntakeTrack = 'estate' | 'college_prep'

export const DEFAULT_INTAKE_TRACK: IntakeTrack = 'estate'

export interface IntakeTrackOption {
  value: IntakeTrack
  title: string
  sub: string
}

export const INTAKE_TRACK_OPTIONS: IntakeTrackOption[] = [
  {
    value: 'estate',
    title: 'Estate Planning',
    sub: 'The full questionnaire — family, assets, goals, and fiduciaries.',
  },
  {
    value: 'college_prep',
    title: 'College Preparation Plan',
    sub: 'For a student turning 18: power of attorney, health care proxy, HIPAA, living will.',
  },
]

const ALL_TRACKS: IntakeTrack[] = INTAKE_TRACK_OPTIONS.map((option) => option.value)

export function normalizeIntakeTrack(value: unknown): IntakeTrack | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return ALL_TRACKS.includes(trimmed as IntakeTrack) ? (trimmed as IntakeTrack) : null
}

/** Resolve the track off an intake row, falling back to the estate default. */
export function getIntakeTrack(row: Record<string, unknown> | null | undefined): IntakeTrack {
  return normalizeIntakeTrack(row?.intake_track) ?? DEFAULT_INTAKE_TRACK
}

export function isCollegePrepIntake(row: Record<string, unknown> | null | undefined): boolean {
  return getIntakeTrack(row) === 'college_prep'
}

export function intakeTrackLabel(value: unknown): string {
  const normalized = normalizeIntakeTrack(value)
  if (!normalized) return typeof value === 'string' ? value : ''
  return INTAKE_TRACK_OPTIONS.find((option) => option.value === normalized)?.title ?? normalized
}
