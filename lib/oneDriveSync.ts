/** No-op stub — OneDrive sync is not used in the drafting-only app. */

export async function mirrorMatterDocumentToOneDrive(_input: {
  matterDocumentId: string
  matterId: string
  r2Key: string
  fileName: string
  folder: string
}): Promise<void> {
  // intentionally empty
}
