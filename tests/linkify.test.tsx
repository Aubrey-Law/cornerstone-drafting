import { describe, expect, it } from 'vitest'
import { isValidElement } from 'react'
import { linkifyText } from '@/lib/linkify'

describe('linkifyText', () => {
  it('turns https URLs into anchors and leaves text alone', () => {
    const parts = linkifyText('Book here: https://calendly.com/x/y?a=1 thanks')
    expect(parts[0]).toBe('Book here: ')
    const anchor = parts[1]
    expect(isValidElement(anchor)).toBe(true)
    expect((anchor as React.ReactElement<{ href: string }>).props.href).toBe('https://calendly.com/x/y?a=1')
    expect(parts[2]).toBe(' thanks')
  })

  it('does not linkify javascript: or bare text', () => {
    const parts = linkifyText('javascript:alert(1) and plain words')
    expect(parts).toHaveLength(1)
    expect(parts[0]).toBe('javascript:alert(1) and plain words')
  })
})
