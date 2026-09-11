// @vitest-environment jsdom
import React, { useEffect } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LazyPlanning } from '@/app/admin/components/LazyPlanning'
describe('collapsed Today planning',()=>{
  it('starts secondary work only when expanded, then retains the mounted state',async()=>{
    const read=vi.fn()
    function Planning(){useEffect(()=>{read()},[]);return <p>Planning ready</p>}
    const {container}=render(<LazyPlanning><Planning /></LazyPlanning>)
    expect(read).not.toHaveBeenCalled()
    expect(screen.queryByText('Planning ready')).toBeNull()
    const details=container.querySelector('details')!
    details.open=true;fireEvent(details,new Event('toggle'))
    await waitFor(()=>expect(read).toHaveBeenCalledTimes(1))
    details.open=false;fireEvent(details,new Event('toggle'))
    details.open=true;fireEvent(details,new Event('toggle'))
    expect(read).toHaveBeenCalledTimes(1)
  })
})
