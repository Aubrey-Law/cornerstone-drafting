import { redirect } from 'next/navigation'

export default async function LegacyDesignRedirect({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/admin/drafting/${id}?step=design`)
}
