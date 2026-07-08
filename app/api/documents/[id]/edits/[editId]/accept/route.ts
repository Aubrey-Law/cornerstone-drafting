import { resolveEdit } from '../_resolve'

/** POST /api/documents/[id]/edits/[editId]/accept — Unauthorized if no bearer. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; editId: string }> },
) {
  return resolveEdit(req, params, 'accept')
}
