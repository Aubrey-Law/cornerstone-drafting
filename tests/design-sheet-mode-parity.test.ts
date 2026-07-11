import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('design sheet mode parity', () => {
  it('uses shared acceleration and final review in Fast Entry', () => {
    const express = readFileSync('app/admin/drafting/[matterId]/design/ExpressDesignSheet.tsx', 'utf8')
    for (const component of ['DesignAccelerationBar', 'DesignFinalReview']) {
      expect(express).toContain(`<${component}`)
    }
  })
})
