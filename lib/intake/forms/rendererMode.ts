export type IntakeRendererMode = 'legacy' | 'compiled'

/** Server-only selection; absent/invalid values retain Phase 1 rollback. */
export function resolveIntakeRendererMode(env: { INTAKE_RENDERER_MODE?: string; [key: string]: string | undefined }): IntakeRendererMode {
  return env.INTAKE_RENDERER_MODE === 'compiled' ? 'compiled' : 'legacy'
}
