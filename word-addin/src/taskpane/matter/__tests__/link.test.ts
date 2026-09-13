import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearLink, documentKey, loadLink, storeLink, type LinkedMatter } from '../link'

const MATTER: LinkedMatter = { id: 'm-1', matterNumber: 'EP-2026-014', clientName: 'Jordan Ellis' }

function fakeStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    get size() {
      return map.size
    },
  }
}

let storage: ReturnType<typeof fakeStorage>

beforeEach(() => {
  storage = fakeStorage()
  ;(globalThis as { localStorage?: unknown }).localStorage = storage
})

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage
})

describe('documentKey', () => {
  it('keys a saved document by its path', () => {
    expect(documentKey('/Users/sp/Matters/ellis-trust.docx')).toBe(
      'cornerstone.addin.matter.v1:/Users/sp/Matters/ellis-trust.docx',
    )
  })

  it('keeps two documents apart', () => {
    expect(documentKey('/a/one.docx')).not.toBe(documentKey('/a/two.docx'))
  })

  it('refuses a key for an unsaved document', () => {
    // Every unsaved document reports the same empty URL. Sharing one key would
    // mean the next new document silently inherited this one's client.
    for (const empty of [null, undefined, '', '   ']) {
      expect(documentKey(empty)).toBeNull()
    }
  })
})

describe('the stored link', () => {
  it('round-trips', () => {
    const key = documentKey('/a/one.docx')
    storeLink(key, MATTER)
    expect(loadLink(key)).toEqual(MATTER)
  })

  it('is scoped to its own document', () => {
    storeLink(documentKey('/a/one.docx'), MATTER)
    expect(loadLink(documentKey('/a/two.docx'))).toBeNull()
  })

  it('clears', () => {
    const key = documentKey('/a/one.docx')
    storeLink(key, MATTER)
    clearLink(key)
    expect(loadLink(key)).toBeNull()
  })

  it('writes nothing for an unsaved document', () => {
    storeLink(null, MATTER)
    expect(storage.size).toBe(0)
    expect(loadLink(null)).toBeNull()
  })

  it('ignores a value of the wrong shape rather than returning a broken link', () => {
    // A link from an older version, or a half-written value. An unlinked pane
    // is a working pane; a LinkedMatter with no id would be sent to the server.
    const key = documentKey('/a/one.docx')!
    for (const junk of ['not json', '{"clientName":"No id"}', '{"id":"","clientName":"x"}', 'null', '[]']) {
      storage.setItem(key, junk)
      expect(loadLink(key)).toBeNull()
    }
  })

  it('survives storage being unavailable', () => {
    // Private browsing and quota failures both throw on access. The link is
    // a convenience; losing it must never take the pane down.
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem() {
        throw new Error('denied')
      },
      setItem() {
        throw new Error('denied')
      },
      removeItem() {
        throw new Error('denied')
      },
    }
    const key = documentKey('/a/one.docx')
    expect(() => storeLink(key, MATTER)).not.toThrow()
    expect(() => clearLink(key)).not.toThrow()
    expect(loadLink(key)).toBeNull()
  })
})
