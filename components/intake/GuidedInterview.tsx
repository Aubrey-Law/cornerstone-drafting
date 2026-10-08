'use client'

import dynamic from 'next/dynamic'
import LegacyGuidedInterview, { type GuidedInterviewProps } from './LegacyGuidedInterview'
import type { CompiledIntakeForm } from '@/lib/intake/forms/compiler'
import type { IntakeRendererMode } from '@/lib/intake/forms/rendererMode'

export { ReviewModal, type GuidedInterviewProps } from './LegacyGuidedInterview'

// Rollback must remain importable even when compiled catalogs cannot initialize.
const SchemaDrivenGuidedInterview = dynamic(() => import('./SchemaDrivenGuidedInterview'))

type Props = GuidedInterviewProps & {
  rendererMode: IntakeRendererMode
  compiledForm?: CompiledIntakeForm
}

/** The server selects a renderer and supplies only audience-filtered content. */
export default function GuidedInterview({ rendererMode, compiledForm, ...props }: Props) {
  if (rendererMode === 'legacy') return <LegacyGuidedInterview {...props} />
  if (!compiledForm) return <p role="alert">This questionnaire is temporarily unavailable. Please contact the firm.</p>
  return <SchemaDrivenGuidedInterview {...props} compiledForm={compiledForm} />
}
