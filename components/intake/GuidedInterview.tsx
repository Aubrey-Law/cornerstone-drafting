'use client'

import LegacyGuidedInterview, { type GuidedInterviewProps } from './LegacyGuidedInterview'
import SchemaDrivenGuidedInterview from './SchemaDrivenGuidedInterview'
import type { CompiledIntakeForm } from '@/lib/intake/forms/compiler'
import type { IntakeRendererMode } from '@/lib/intake/forms/rendererMode'

export type { GuidedInterviewProps } from './LegacyGuidedInterview'
export { ReviewModal } from './LegacyGuidedInterview'

type Props = GuidedInterviewProps & {
  rendererMode: IntakeRendererMode
  compiledForm: CompiledIntakeForm
}

/** The server selects a renderer and supplies only audience-filtered content. */
export default function GuidedInterview({ rendererMode, compiledForm, ...props }: Props) {
  return rendererMode === 'compiled'
    ? <SchemaDrivenGuidedInterview {...props} compiledForm={compiledForm} />
    : <LegacyGuidedInterview {...props} />
}
