import { redirect } from 'next/navigation'

/** Legacy bookmark from the portal matter UI. */
export default async function LegacyMatterDesignRedirect({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/admin/drafting/${id}?step=design`)
}
