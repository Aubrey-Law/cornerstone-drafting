import { Suspense } from 'react'
import { AssistantShell } from '../../AssistantShell'

export default async function AssistantChatPage({ params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await params
  return (
    <Suspense>
      <AssistantShell chatId={chatId} />
    </Suspense>
  )
}
