'use client'

import LegacyGuidedInterview, { ReviewModal as SharedReviewModal, type GuidedInterviewProps } from './LegacyGuidedInterview'
import type { ComponentProps } from 'react'
import { getActiveSteps, getStepIssues } from '@/lib/intakeSections'
import SchemaDrivenGuidedInterview from './SchemaDrivenGuidedInterview'
import type { CompiledIntakeForm } from '@/lib/intake/forms/compiler'
import type { IntakeRendererMode } from '@/lib/intake/forms/rendererMode'

export type { GuidedInterviewProps } from './LegacyGuidedInterview'
export function ReviewModal(props: ComponentProps<typeof SharedReviewModal>) {
  return <SharedReviewModal {...props} reviewSelectors={props.reviewSelectors ?? { getActiveSteps, getStepIssues }} />
}

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
