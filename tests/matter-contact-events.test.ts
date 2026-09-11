// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { notifyMatterContactsChanged, listenForMatterContacts } from '@/lib/matters/contactEvents'
it('refreshes only the affected matter and unsubscribes on unmount', () => {
  const refresh=vi.fn()
  const stop=listenForMatterContacts('m1', refresh)
  notifyMatterContactsChanged('m2')
  expect(refresh).not.toHaveBeenCalled()
  notifyMatterContactsChanged('m1')
  expect(refresh).toHaveBeenCalledOnce()
  stop()
  notifyMatterContactsChanged('m1')
  expect(refresh).toHaveBeenCalledOnce()
})
