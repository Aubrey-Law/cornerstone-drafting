import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./lib/sentry/server')
    // Keep work_skills in step with the bundled workflow tree on every deploy.
    // Production only: a local checkout on a branch must not push its edited
    // SKILL.md files into the firm database (local dev points at it).
    if (process.env.NODE_ENV === 'production') {
      const { ensureSystemWorkflowsSynced } = await import('./lib/works/systemSync')
      await ensureSystemWorkflowsSynced()
    }
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./lib/sentry/edge')
  }
}

export const onRequestError = Sentry.captureRequestError
