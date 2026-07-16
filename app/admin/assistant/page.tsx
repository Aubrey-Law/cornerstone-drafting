import { Suspense } from 'react'
import { AssistantShell } from './AssistantShell'

export default function AssistantPage() {
  return (
    <Suspense>
      <AssistantShell />
    </Suspense>
  )
}
