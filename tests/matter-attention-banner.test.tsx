// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MatterBlockerBanner } from '@/app/admin/matters/[id]/MatterBlockerBanner'
afterEach(cleanup)
it('links unread messages and incoming uploads without calling them drafting blockers',()=>{
  render(<MatterBlockerBanner matterId="m1" reviewFlags={[]} unreviewedUploadCounts={{intake:0,portal:2,total:2}} unreadPortalCount={3} draftingHref="/admin/drafting/m1" />)
  expect(screen.queryByText(/Drafting is blocked/)).toBeNull()
  expect(screen.getByRole('link',{name:/3 unread messages/}).getAttribute('href')).toBe('/admin/matters/m1?tab=communications&channel=portal')
  expect(screen.getByRole('link',{name:/2 portal uploads/}).getAttribute('href')).toBe('/admin/matters/m1?tab=documents&scope=unreviewed')
})
it('gives each review flag its own resolution link',()=>{
  render(<MatterBlockerBanner matterId="m1" reviewFlags={[{key:'county_missing',label:'County',sectionId:'personal',severity:'review',resolutionKind:'needs_data',message:'County missing'}]} unreviewedUploadCounts={{intake:0,portal:0,total:0}} unreadPortalCount={0} draftingHref="/admin/drafting/m1" onReviewIntakeUploads={vi.fn()} />)
  expect(screen.getByRole('link',{name:'County'}).getAttribute('href')).toContain('focus=')
  expect(screen.queryByRole('link',{name:'Draft anyway'})).toBeNull()
})
it('leaves out the shortcut to the tab already on screen',()=>{
  render(<MatterBlockerBanner matterId="m1" reviewFlags={[]} unreviewedUploadCounts={{intake:0,portal:2,total:2}} unreadPortalCount={3} draftingHref="/admin/drafting/m1" activeTab="documents" />)
  expect(screen.queryByRole('link',{name:/portal uploads/})).toBeNull()
  expect(screen.getByRole('link',{name:/3 unread messages/})).toBeTruthy()
  cleanup()
  const {container}=render(<MatterBlockerBanner matterId="m1" reviewFlags={[]} unreviewedUploadCounts={{intake:0,portal:0,total:0}} unreadPortalCount={3} draftingHref="/admin/drafting/m1" activeTab="communications" />)
  expect(container.textContent).toBe('')
})
