// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MatterOverviewHero } from '@/app/admin/matters/[id]/MatterOverviewHero'
import type { PipelineMatter } from '@/types/database'

afterEach(cleanup)

describe('MatterOverviewHero', () => {
  it('focuses on the next action without repeating contact facts', () => {
    const matter = {
      matter_id: 'matter-1',
      matter_name: 'Whitfield Trust',
      client_name: 'Margaret Whitfield',
      client_email: 'margaret@example.com',
      client_phone: '+16175550101',
      spouse_name: 'Thomas Whitfield',
      spouse_email: 'thomas@example.com',
      spouse_phone: '+16175550102',
      stage: 'drafting',
    } as PipelineMatter

    render(
      <MatterOverviewHero
        matter={matter}
        nextAction={{
          kind: 'draft',
          title: 'Open drafting workspace',
          detail: 'Complete the design sheet and generate drafts.',
          href: '/admin/drafting/matter-1',
          cta: 'Open drafting',
          tone: 'default',
        }}
        unreadPortalCount={0}
        reviewFlags={[]}
        lastPortalMessage={null}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Open drafting workspace' })).toBeTruthy()
    expect(document.body.textContent).not.toContain('margaret@example.com')
    expect(document.body.textContent).not.toContain('thomas@example.com')
  })
})
