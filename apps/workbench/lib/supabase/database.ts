/**
 * The schema this app talks to.
 *
 * The generated types, shared with the old app through `@aubrey-law/db-types`,
 * rather than a description of the schema maintained here. This started as a
 * hand-written type covering the one table the app read, which was honest at
 * the time and would have become a second source of truth the moment anyone
 * forgot to update it.
 *
 * A type-only re-export, so nothing survives compilation.
 */
export type { Database as WorkbenchDatabase } from '@aubrey-law/db-types'
