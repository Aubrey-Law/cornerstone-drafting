import { loadBundledEstateClauseSnapshot } from '@/lib/estateClauses/fileRepository'
import {
  loadPublishedEstateClauseSnapshot,
  type EstateClauseClient,
} from '@/lib/estateClauses/repository'
import type { EstateClauseSnapshot } from '@/lib/estateClauses/types'

export interface LoadSnapshotArgs {
  matterId: string
  jurisdiction: string
  client: EstateClauseClient
  root?: string
  allowDraft?: boolean
}

export function estateClauseSource(): 'file' | 'database' {
  return process.env.ESTATE_CLAUSE_SOURCE === 'database' ? 'database' : 'file'
}

export async function loadEstateClauseSnapshot(args: LoadSnapshotArgs): Promise<EstateClauseSnapshot> {
  if (args.jurisdiction !== 'MA') {
    throw new Error(`Unsupported estate clause jurisdiction: ${args.jurisdiction}`)
  }
  if (estateClauseSource() === 'database') {
    return loadPublishedEstateClauseSnapshot({ client: args.client, matterId: args.matterId })
  }
  return loadBundledEstateClauseSnapshot({
    root: args.root,
    jurisdiction: args.jurisdiction,
    allowDraft: args.allowDraft,
  })
}
