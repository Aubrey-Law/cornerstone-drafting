/**
 * Independent DOCX tracked-change editing.
 *
 * Applies substitutions as OOXML <w:ins>/<w:del> revisions, resolves them
 * by w:id, and extracts accepted-view body text — without mutating plain
 * document text in place.
 */

import JSZip from 'jszip'
import { XMLParser, XMLBuilder } from 'fast-xml-parser'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EditInput {
  find: string
  replace: string
  context_before: string
  context_after: string
  reason?: string
}

export interface AppliedChange {
  id: string
  delId?: string
  insId?: string
  deletedText: string
  insertedText: string
  contextBefore: string
  contextAfter: string
  reason?: string
}

export interface EditError {
  index: number
  reason: string
}

export interface ApplyTrackedEditsResult {
  bytes: Buffer
  changes: AppliedChange[]
  errors: EditError[]
}

// ---------------------------------------------------------------------------
// ZIP path helpers (Windows backslash quirks)
// ---------------------------------------------------------------------------

const DOCUMENT_XML = 'word/document.xml'

function getZipEntry(zip: JSZip, pathSlash: string) {
  const direct = zip.file(pathSlash)
  if (direct) return direct
  return zip.file(pathSlash.replace(/\//g, '\\'))
}

function setZipEntry(zip: JSZip, pathSlash: string, content: string | Buffer): void {
  const backslash = pathSlash.replace(/\//g, '\\')
  if (!zip.file(pathSlash) && zip.file(backslash)) {
    zip.file(backslash, content)
    return
  }
  zip.file(pathSlash, content)
}

// ---------------------------------------------------------------------------
// XML helpers (preserveOrder trees)
// ---------------------------------------------------------------------------

type XmlNode = Record<string, unknown>
type XmlForest = XmlNode[]

const PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
})

const BUILDER = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  suppressEmptyNode: true,
  format: false,
})

const CONTAINER_TAGS = new Set([
  'w:tbl',
  'w:tr',
  'w:tc',
  'w:sdt',
  'w:sdtContent',
])

function nodeTag(node: XmlNode): string | null {
  for (const key of Object.keys(node)) {
    if (key !== ':@') return key
  }
  return null
}

function nodeChildren(node: XmlNode): XmlForest {
  const tag = nodeTag(node)
  if (!tag) return []
  const value = node[tag]
  return Array.isArray(value) ? (value as XmlForest) : []
}

function setNodeChildren(node: XmlNode, children: XmlForest): void {
  const tag = nodeTag(node)
  if (!tag) return
  node[tag] = children
}

function nodeAttrs(node: XmlNode): Record<string, string> {
  const attrs = node[':@']
  if (!attrs || typeof attrs !== 'object') return {}
  return attrs as Record<string, string>
}

function getAttr(node: XmlNode, name: string): string | undefined {
  const attrs = nodeAttrs(node)
  const key = name.startsWith('@_') ? name : `@_${name}`
  const value = attrs[key]
  return typeof value === 'string' ? value : undefined
}

function setAttr(node: XmlNode, name: string, value: string): void {
  const key = name.startsWith('@_') ? name : `@_${name}`
  if (!node[':@'] || typeof node[':@'] !== 'object') {
    node[':@'] = {}
  }
  ;(node[':@'] as Record<string, string>)[key] = value
}

function textContent(node: XmlNode): string {
  const tag = nodeTag(node)
  if (!tag) return ''
  const value = node[tag]
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  let out = ''
  for (const child of value as XmlForest) {
    const childTag = nodeTag(child)
    if (childTag === '#text') {
      const t = child['#text']
      out += typeof t === 'string' ? t : ''
    } else if (childTag) {
      out += textContent(child)
    }
  }
  return out
}

function makeTextNode(tag: string, text: string, preserveSpace = true): XmlNode {
  const node: XmlNode = {
    [tag]: [{ '#text': text }],
  }
  if (preserveSpace) {
    node[':@'] = { '@_xml:space': 'preserve' }
  }
  return node
}

function cloneDeep<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function findFirstByTag(forest: XmlForest, tag: string): XmlNode | null {
  for (const node of forest) {
    if (nodeTag(node) === tag) return node
    const nested = findFirstByTag(nodeChildren(node), tag)
    if (nested) return nested
  }
  return null
}

function collectParagraphs(forest: XmlForest, out: XmlNode[] = []): XmlNode[] {
  for (const node of forest) {
    const tag = nodeTag(node)
    if (tag === 'w:p') {
      out.push(node)
      continue
    }
    if (tag && CONTAINER_TAGS.has(tag)) {
      collectParagraphs(nodeChildren(node), out)
    } else if (tag) {
      // Still walk unknown parents that may hold nested structural content.
      collectParagraphs(nodeChildren(node), out)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Accepted-view flattening & whitespace normalization
// ---------------------------------------------------------------------------

interface FlatChar {
  /** Character in the accepted-view string before whitespace normalization. */
  ch: string
}

function extractRunPlainText(run: XmlNode): string {
  let out = ''
  for (const child of nodeChildren(run)) {
    const tag = nodeTag(child)
    if (tag === 'w:t') {
      out += textContent(child)
    } else if (tag === 'w:tab') {
      out += '\t'
    } else if (tag === 'w:br' || tag === 'w:cr') {
      out += '\n'
    }
  }
  return out
}

function flattenAcceptedChars(forest: XmlForest, out: FlatChar[] = []): FlatChar[] {
  for (const node of forest) {
    const tag = nodeTag(node)
    if (!tag) continue

    if (tag === 'w:del') {
      // Deletions are invisible in the accepted view.
      continue
    }

    if (tag === 'w:ins' || tag === 'w:hyperlink' || tag === 'w:smartTag') {
      flattenAcceptedChars(nodeChildren(node), out)
      continue
    }

    if (tag === 'w:r') {
      const text = extractRunPlainText(node)
      for (const ch of text) out.push({ ch })
      continue
    }

    // Nested structural / wrapper content inside a paragraph.
    flattenAcceptedChars(nodeChildren(node), out)
  }
  return out
}

function flattenParagraphAccepted(paragraph: XmlNode): string {
  return flattenAcceptedChars(nodeChildren(paragraph))
    .map((c) => c.ch)
    .join('')
}

/** Normalize for matching; return normalized string + map of norm index → original index. */
function normalizeForMatch(raw: string): { normalized: string; origIdx: number[] } {
  const mapped: Array<{ ch: string; orig: number }> = []

  for (let i = 0; i < raw.length; i++) {
    let ch = raw[i]!
    // Smart quotes → ASCII
    if (ch === '\u2018' || ch === '\u2019') ch = "'"
    else if (ch === '\u201C' || ch === '\u201D') ch = '"'
    // En/em dash → hyphen
    else if (ch === '\u2013' || ch === '\u2014') ch = '-'
    // NBSP → space
    else if (ch === '\u00A0') ch = ' '

    if (/\s/.test(ch)) {
      const prev = mapped[mapped.length - 1]
      if (prev && prev.ch === ' ') {
        // Collapsed — keep earliest original index already recorded.
        continue
      }
      mapped.push({ ch: ' ', orig: i })
    } else {
      mapped.push({ ch, orig: i })
    }
  }

  // Trim leading/trailing collapsed whitespace for matching stability at edges.
  while (mapped.length && mapped[0]!.ch === ' ') mapped.shift()
  while (mapped.length && mapped[mapped.length - 1]!.ch === ' ') mapped.pop()

  return {
    normalized: mapped.map((m) => m.ch).join(''),
    origIdx: mapped.map((m) => m.orig),
  }
}

function normalizeQuery(raw: string): string {
  return normalizeForMatch(raw).normalized
}

// ---------------------------------------------------------------------------
// Locate unique edit hits
// ---------------------------------------------------------------------------

interface LocateHit {
  /** Paragraph index within collected paragraphs. */
  paraIndex: number
  /** Start/end in the paragraph's raw accepted-view string (exclusive end). */
  start: number
  end: number
}

function mapNormRangeToOrig(
  origIdx: number[],
  normStart: number,
  normEnd: number,
  rawLength: number,
): { start: number; end: number } | null {
  if (normStart < 0 || normEnd < normStart) return null
  if (normStart === normEnd) {
    // Pure insertion point.
    if (normStart >= origIdx.length) {
      return { start: rawLength, end: rawLength }
    }
    return { start: origIdx[normStart]!, end: origIdx[normStart]! }
  }
  if (normEnd > origIdx.length) return null
  const start = origIdx[normStart]!
  // End is exclusive: last matched char's original index + 1.
  const lastOrig = origIdx[normEnd - 1]!
  return { start, end: lastOrig + 1 }
}

function findAllInNormalized(
  haystack: string,
  needle: string,
): Array<{ start: number; end: number }> {
  if (needle.length === 0) return []
  const hits: Array<{ start: number; end: number }> = []
  let from = 0
  while (from <= haystack.length) {
    const idx = haystack.indexOf(needle, from)
    if (idx < 0) break
    hits.push({ start: idx, end: idx + needle.length })
    from = idx + 1
  }
  return hits
}

/** Pure-insert: locate the boundary between context_before and context_after. */
function findInsertBoundaries(
  haystack: string,
  before: string,
  after: string,
): Array<{ start: number; end: number }> {
  const hits: Array<{ start: number; end: number }> = []
  if (!before && !after) return hits

  if (before && after) {
    let from = 0
    while (from <= haystack.length) {
      const b = haystack.indexOf(before, from)
      if (b < 0) break
      const afterStart = b + before.length
      if (haystack.slice(afterStart, afterStart + after.length) === after) {
        hits.push({ start: afterStart, end: afterStart })
      }
      from = b + 1
    }
    return hits
  }

  if (before) {
    let from = 0
    while (from <= haystack.length) {
      const b = haystack.indexOf(before, from)
      if (b < 0) break
      const pos = b + before.length
      hits.push({ start: pos, end: pos })
      from = b + 1
    }
    return hits
  }

  // after only
  let from = 0
  while (from <= haystack.length) {
    const a = haystack.indexOf(after, from)
    if (a < 0) break
    hits.push({ start: a, end: a })
    from = a + 1
  }
  return hits
}

interface ParaIndex {
  paraIndex: number
  raw: string
  normalized: string
  origIdx: number[]
}

function buildParaIndexes(paragraphs: XmlNode[]): ParaIndex[] {
  return paragraphs.map((p, paraIndex) => {
    const raw = flattenParagraphAccepted(p)
    const { normalized, origIdx } = normalizeForMatch(raw)
    return { paraIndex, raw, normalized, origIdx }
  })
}

function locateEdit(edit: EditInput, paras: ParaIndex[]): LocateHit | { error: string } {
  const findN = normalizeQuery(edit.find)
  const beforeN = normalizeQuery(edit.context_before)
  const afterN = normalizeQuery(edit.context_after)
  const isPureInsert = edit.find.length === 0

  if (isPureInsert && !beforeN && !afterN) {
    return { error: 'Pure insert requires context_before and/or context_after' }
  }

  type Strat = { name: string; before: string; after: string; find: string }
  const strategies: Strat[] = []

  if (isPureInsert) {
    strategies.push({ name: 'full-context-insert', before: beforeN, after: afterN, find: '' })
    if (beforeN.length >= afterN.length && beforeN) {
      strategies.push({ name: 'drop-shorter-after', before: beforeN, after: '', find: '' })
    } else if (afterN) {
      strategies.push({ name: 'drop-shorter-before', before: '', after: afterN, find: '' })
    }
  } else {
    strategies.push({
      name: 'full-context',
      before: beforeN,
      after: afterN,
      find: findN,
    })
    // Drop the shorter context side.
    if (beforeN.length && afterN.length) {
      if (beforeN.length <= afterN.length) {
        strategies.push({
          name: 'drop-shorter-before',
          before: '',
          after: afterN,
          find: findN,
        })
      } else {
        strategies.push({
          name: 'drop-shorter-after',
          before: beforeN,
          after: '',
          find: findN,
        })
      }
    } else if (beforeN.length) {
      strategies.push({ name: 'before-only', before: beforeN, after: '', find: findN })
    } else if (afterN.length) {
      strategies.push({ name: 'after-only', before: '', after: afterN, find: findN })
    }
    strategies.push({ name: 'find-only', before: '', after: '', find: findN })
  }

  for (const strat of strategies) {
    const docHits: LocateHit[] = []

    for (const para of paras) {
      let normHits: Array<{ start: number; end: number }>

      if (isPureInsert || strat.find === '') {
        normHits = findInsertBoundaries(para.normalized, strat.before, strat.after)
      } else {
        const needle =
          strat.before || strat.after
            ? `${strat.before}${strat.find}${strat.after}`
            : strat.find
        const fullHits = findAllInNormalized(para.normalized, needle)
        normHits = fullHits.map((h) => ({
          start: h.start + strat.before.length,
          end: h.start + strat.before.length + strat.find.length,
        }))
      }

      for (const nh of normHits) {
        const mapped = mapNormRangeToOrig(para.origIdx, nh.start, nh.end, para.raw.length)
        if (!mapped) continue
        docHits.push({
          paraIndex: para.paraIndex,
          start: mapped.start,
          end: mapped.end,
        })
      }
    }

    if (docHits.length === 1) return docHits[0]!
    if (docHits.length > 1) {
      // Ambiguous under this strategy — try a more relaxed one only if this
      // wasn't find-only; find-only ambiguity is fatal once reached.
      if (strat.name === 'find-only' || strat.name.startsWith('drop-shorter') || isPureInsert) {
        if (docHits.length > 1) {
          continue
        }
      }
      continue
    }
  }

  return { error: 'No unique match for edit' }
}

// ---------------------------------------------------------------------------
// Diff collapse (shared prefix / suffix)
// ---------------------------------------------------------------------------

function collapseDiff(
  find: string,
  replace: string,
): { deleted: string; inserted: string; prefixLen: number; suffixLen: number } {
  let prefixLen = 0
  const minLen = Math.min(find.length, replace.length)
  while (
    prefixLen < minLen &&
    find[prefixLen] === replace[prefixLen]
  ) {
    prefixLen++
  }

  let suffixLen = 0
  while (
    suffixLen < minLen - prefixLen &&
    find[find.length - 1 - suffixLen] === replace[replace.length - 1 - suffixLen]
  ) {
    suffixLen++
  }

  return {
    deleted: find.slice(prefixLen, find.length - suffixLen),
    inserted: replace.slice(prefixLen, replace.length - suffixLen),
    prefixLen,
    suffixLen,
  }
}

// ---------------------------------------------------------------------------
// Revision id allocation
// ---------------------------------------------------------------------------

function collectMaxWId(forest: XmlForest): number {
  let max = 0
  const walk = (nodes: XmlForest) => {
    for (const node of nodes) {
      const tag = nodeTag(node)
      if (tag === 'w:ins' || tag === 'w:del') {
        const id = getAttr(node, 'w:id')
        if (id != null) {
          const n = Number.parseInt(id, 10)
          if (!Number.isNaN(n) && n > max) max = n
        }
      }
      walk(nodeChildren(node))
    }
  }
  walk(forest)
  return max
}

// ---------------------------------------------------------------------------
// Paragraph reconstruction around a tracked edit
// ---------------------------------------------------------------------------

interface RunSlice {
  /** Characters contributed to the accepted-view string by this run (may be empty). */
  text: string
  /** Original w:r node (for cloning rPr / non-text children when untouched). */
  run: XmlNode
  /** True when this run sits under an existing w:ins that should be unwrapped for edits. */
  underIns: boolean
}

function collectRunSlices(forest: XmlForest, underIns = false, out: RunSlice[] = []): RunSlice[] {
  for (const node of forest) {
    const tag = nodeTag(node)
    if (!tag) continue

    if (tag === 'w:del') {
      continue
    }
    if (tag === 'w:ins') {
      collectRunSlices(nodeChildren(node), true, out)
      continue
    }
    if (tag === 'w:r') {
      out.push({
        text: extractRunPlainText(node),
        run: node,
        underIns,
      })
      continue
    }
    // Other wrappers (hyperlink, etc.)
    collectRunSlices(nodeChildren(node), underIns, out)
  }
  return out
}

function findNearestRPr(slices: RunSlice[], charIndex: number): XmlNode | null {
  // Locate the slice covering charIndex (or nearest preceding).
  let offset = 0
  let nearest: XmlNode | null = null
  for (const slice of slices) {
    const next = offset + slice.text.length
    const rPr = nodeChildren(slice.run).find((c) => nodeTag(c) === 'w:rPr')
    if (rPr) nearest = rPr
    if (charIndex >= offset && charIndex < next) {
      return rPr ? cloneDeep(rPr) : nearest ? cloneDeep(nearest) : null
    }
    if (charIndex === next && rPr) {
      // Boundary after this slice.
      nearest = rPr
    }
    offset = next
  }
  return nearest ? cloneDeep(nearest) : null
}

function splitTextToRunChildren(text: string, asDeletion: boolean): XmlForest {
  const children: XmlForest = []
  const parts = text.split('\n')
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) {
      children.push({ 'w:br': [] })
    }
    const part = parts[i]!
    if (part.length === 0 && !(parts.length === 1)) {
      // Empty segment between breaks — skip empty text node except sole empty string.
      continue
    }
    if (asDeletion) {
      children.push(makeTextNode('w:delText', part, true))
    } else {
      children.push(makeTextNode('w:t', part, true))
    }
  }
  // Ensure at least one text node when text is empty but we still need a run
  // (should not happen for empty deleted/inserted after collapse).
  if (children.length === 0 && text.length === 0) {
    children.push(asDeletion ? makeTextNode('w:delText', '', true) : makeTextNode('w:t', '', true))
  }
  return children
}

function makeTrackedRun(
  text: string,
  asDeletion: boolean,
  rPr: XmlNode | null,
): XmlNode {
  const children: XmlForest = []
  if (rPr) children.push(cloneDeep(rPr))
  children.push(...splitTextToRunChildren(text, asDeletion))
  return { 'w:r': children }
}

function makeInsWrapper(
  id: string,
  author: string,
  date: string,
  runs: XmlForest,
): XmlNode {
  return {
    'w:ins': runs,
    ':@': {
      '@_w:id': id,
      '@_w:author': author,
      '@_w:date': date,
    },
  }
}

function makeDelWrapper(
  id: string,
  author: string,
  date: string,
  runs: XmlForest,
): XmlNode {
  return {
    'w:del': runs,
    ':@': {
      '@_w:id': id,
      '@_w:author': author,
      '@_w:date': date,
    },
  }
}

function cloneRunWithText(sourceRun: XmlNode, text: string): XmlNode {
  const rPr = nodeChildren(sourceRun).find((c) => nodeTag(c) === 'w:rPr')
  const children: XmlForest = []
  if (rPr) children.push(cloneDeep(rPr))
  // Preserve non-text curiosities only when text is empty? Prefer clean rebuild.
  children.push(...splitTextToRunChildren(text, false))
  return { 'w:r': children }
}

function emitTextRegion(
  slices: RunSlice[],
  regionStart: number,
  regionEnd: number,
  into: XmlForest,
): void {
  let cursor = 0
  for (const slice of slices) {
    const sliceEnd = cursor + slice.text.length
    const overlapStart = Math.max(cursor, regionStart)
    const overlapEnd = Math.min(sliceEnd, regionEnd)
    if (overlapStart < overlapEnd) {
      const piece = slice.text.slice(
        overlapStart - cursor,
        overlapEnd - cursor,
      )
      if (piece.length) {
        into.push(cloneRunWithText(slice.run, piece))
      }
    }
    cursor = sliceEnd
    if (cursor >= regionEnd) break
  }
}

/**
 * Rebuild paragraph children so [start, end) is replaced by tracked ins/del.
 * Emits w:ins BEFORE w:del at the edit boundary.
 */
function rebuildParagraphWithEdit(
  paragraph: XmlNode,
  start: number,
  end: number,
  insertedText: string,
  deletedText: string,
  ids: { insId?: string; delId?: string },
  author: string,
  date: string,
): void {
  const children = nodeChildren(paragraph)
  const slices = collectRunSlices(children)

  // Preserve leading non-run content (e.g. w:pPr); drop old run/revision nodes.
  const leading: XmlForest = []
  const trailing: XmlForest = []
  let seenRunContent = false
  for (const child of children) {
    const tag = nodeTag(child)
    if (tag === 'w:pPr') {
      leading.push(child)
      continue
    }
    if (
      tag === 'w:r' ||
      tag === 'w:ins' ||
      tag === 'w:del' ||
      tag === 'w:hyperlink' ||
      tag === 'w:smartTag'
    ) {
      seenRunContent = true
      continue
    }
    if (!seenRunContent) leading.push(child)
    else trailing.push(child)
  }

  const totalLen = slices.reduce((n, s) => n + s.text.length, 0)
  const rPr = findNearestRPr(slices, start)
  const rebuilt: XmlForest = [...leading]

  emitTextRegion(slices, 0, start, rebuilt)

  // Tracked change at boundary: ins then del.
  if (insertedText.length && ids.insId != null) {
    rebuilt.push(
      makeInsWrapper(ids.insId, author, date, [
        makeTrackedRun(insertedText, false, rPr),
      ]),
    )
  }
  if (deletedText.length && ids.delId != null) {
    rebuilt.push(
      makeDelWrapper(ids.delId, author, date, [
        makeTrackedRun(deletedText, true, rPr),
      ]),
    )
  }

  emitTextRegion(slices, end, totalLen, rebuilt)
  rebuilt.push(...trailing)
  setNodeChildren(paragraph, rebuilt)
}

// ---------------------------------------------------------------------------
// Resolve (accept / reject) helpers
// ---------------------------------------------------------------------------

function renameDelTextToT(forest: XmlForest): void {
  for (const node of forest) {
    const tag = nodeTag(node)
    if (tag === 'w:delText') {
      const children = nodeChildren(node)
      const attrs = node[':@']
      delete node['w:delText']
      node['w:t'] = children
      if (attrs) node[':@'] = attrs
    } else {
      renameDelTextToT(nodeChildren(node))
    }
  }
}

function resolveRevisionNodes(
  forest: XmlForest,
  targetIds: Set<string>,
  mode: 'accept' | 'reject',
): { forest: XmlForest; found: number } {
  let found = 0
  const result: XmlForest = []

  for (const node of forest) {
    const tag = nodeTag(node)

    if (tag === 'w:ins' || tag === 'w:del') {
      const id = getAttr(node, 'w:id')
      if (id != null && targetIds.has(id)) {
        found++
        if (mode === 'accept') {
          if (tag === 'w:ins') {
            // Unwrap: keep children in place.
            const { forest: inner, found: nested } = resolveRevisionNodes(
              nodeChildren(node),
              targetIds,
              mode,
            )
            found += nested
            result.push(...inner)
          } else {
            // Drop deletion.
            // Still count nested targeted revisions if any (unusual).
            const { found: nested } = resolveRevisionNodes(
              nodeChildren(node),
              targetIds,
              mode,
            )
            found += nested
          }
        } else {
          // reject
          if (tag === 'w:ins') {
            const { found: nested } = resolveRevisionNodes(
              nodeChildren(node),
              targetIds,
              mode,
            )
            found += nested
            // Drop insertion.
          } else {
            // Unwrap deletion; rename delText → t.
            const inner = cloneDeep(nodeChildren(node))
            renameDelTextToT(inner)
            const { forest: resolved, found: nested } = resolveRevisionNodes(
              inner,
              targetIds,
              mode,
            )
            found += nested
            result.push(...resolved)
          }
        }
        continue
      }
    }

    const kids = nodeChildren(node)
    if (kids.length) {
      const { forest: newKids, found: nested } = resolveRevisionNodes(
        kids,
        targetIds,
        mode,
      )
      found += nested
      setNodeChildren(node, newKids)
    }
    result.push(node)
  }

  return { forest: result, found }
}

function collectTrackedIds(forest: XmlForest, out: Array<{ kind: 'ins' | 'del'; w_id: string }>): void {
  for (const node of forest) {
    const tag = nodeTag(node)
    if (tag === 'w:ins' || tag === 'w:del') {
      const id = getAttr(node, 'w:id')
      if (id != null) {
        out.push({ kind: tag === 'w:ins' ? 'ins' : 'del', w_id: id })
      }
    }
    collectTrackedIds(nodeChildren(node), out)
  }
}

// ---------------------------------------------------------------------------
// Document load / save
// ---------------------------------------------------------------------------

interface LoadedDoc {
  zip: JSZip
  tree: XmlForest
  body: XmlNode
  xmlDeclaration: string | null
}

async function loadDocument(bytes: Buffer): Promise<LoadedDoc> {
  const zip = await JSZip.loadAsync(bytes)
  const entry = getZipEntry(zip, DOCUMENT_XML)
  if (!entry) {
    throw new Error('DOCX is missing word/document.xml')
  }
  const xml = await entry.async('string')
  const declMatch = xml.match(/^<\?xml\b[^?]*\?>/)
  const xmlDeclaration = declMatch ? declMatch[0] : null
  const tree = PARSER.parse(xml) as XmlForest
  const body = findFirstByTag(tree, 'w:body')
  if (!body) {
    throw new Error('document.xml has no w:body')
  }
  return { zip, tree, body, xmlDeclaration }
}

async function saveDocument(loaded: LoadedDoc): Promise<Buffer> {
  let xml = BUILDER.build(loaded.tree) as string
  if (loaded.xmlDeclaration) {
    if (!xml.startsWith('<?xml')) {
      xml = `${loaded.xmlDeclaration}${xml}`
    }
  } else if (!xml.startsWith('<?xml')) {
    xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${xml}`
  }
  setZipEntry(loaded.zip, DOCUMENT_XML, xml)
  const out = await loaded.zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  })
  return Buffer.from(out)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function extractDocxBodyText(bytes: Buffer): Promise<string> {
  const { body } = await loadDocument(bytes)
  const paragraphs = collectParagraphs(nodeChildren(body))
  return paragraphs.map((p) => flattenParagraphAccepted(p)).join('\n')
}

export async function extractTrackedChangeIds(
  bytes: Buffer,
): Promise<Array<{ kind: 'ins' | 'del'; w_id: string }>> {
  const { body } = await loadDocument(bytes)
  const out: Array<{ kind: 'ins' | 'del'; w_id: string }> = []
  collectTrackedIds(nodeChildren(body), out)
  return out
}

export async function applyTrackedEdits(
  bytes: Buffer,
  edits: EditInput[],
  options?: { author?: string },
): Promise<ApplyTrackedEditsResult> {
  const author = options?.author ?? 'Cornerstone'
  const date = new Date().toISOString()
  const loaded = await loadDocument(bytes)
  const paragraphs = collectParagraphs(nodeChildren(loaded.body))
  let nextWId = collectMaxWId(loaded.tree) + 1

  const changes: AppliedChange[] = []
  const errors: EditError[] = []

  // Apply sequentially so later edits see earlier tracked changes in accepted view.
  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i]!
    const paraIndexes = buildParaIndexes(paragraphs)
    const located = locateEdit(edit, paraIndexes)

    if ('error' in located) {
      errors.push({ index: i, reason: located.error })
      continue
    }

    const para = paragraphs[located.paraIndex]!
    const raw = flattenParagraphAccepted(para)
    const deletedFromDoc = raw.slice(located.start, located.end)

    const collapsed = collapseDiff(deletedFromDoc, edit.replace)
    const editStart = located.start + collapsed.prefixLen
    const editEnd = located.end - collapsed.suffixLen

    let insId: string | undefined
    let delId: string | undefined

    if (collapsed.inserted.length) {
      insId = String(nextWId++)
    }
    if (collapsed.deleted.length) {
      delId = String(nextWId++)
    }

    // Nothing to mark (identical after collapse).
    if (!insId && !delId) {
      errors.push({ index: i, reason: 'Edit is a no-op after diff collapse' })
      continue
    }

    rebuildParagraphWithEdit(
      para,
      editStart,
      editEnd,
      collapsed.inserted,
      collapsed.deleted,
      { insId, delId },
      author,
      date,
    )

    const id = insId ?? delId ?? String(nextWId)
    changes.push({
      id,
      delId,
      insId,
      deletedText: collapsed.deleted,
      insertedText: collapsed.inserted,
      contextBefore: edit.context_before,
      contextAfter: edit.context_after,
      reason: edit.reason,
    })
  }

  const outBytes = await saveDocument(loaded)
  return { bytes: outBytes, changes, errors }
}

export async function resolveTrackedChange(
  bytes: Buffer,
  wIds: string[],
  mode: 'accept' | 'reject',
): Promise<{ bytes: Buffer; found: number }> {
  const loaded = await loadDocument(bytes)
  const targetIds = new Set(wIds)
  const bodyChildren = nodeChildren(loaded.body)
  const { forest, found } = resolveRevisionNodes(bodyChildren, targetIds, mode)
  setNodeChildren(loaded.body, forest)
  const outBytes = await saveDocument(loaded)
  return { bytes: outBytes, found }
}
