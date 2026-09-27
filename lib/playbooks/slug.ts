/**
 * A playbook's id — `prompts.slug` — and how one is suggested from a title.
 *
 * Its own module, apart from `./publish`, because the builder runs this in the
 * browser and `./publish` pulls in `node:crypto` and the database client.
 */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '')
}
