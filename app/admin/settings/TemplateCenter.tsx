'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EmailTemplatesSection } from './EmailTemplatesSection'
import { EsignTemplateEditor } from './EsignTemplateEditor'
import { EstateClauseLibrarySection } from './estate-clauses/EstateClauseLibrarySection'

export function TemplateCenter({ currentUserId }: { currentUserId: string }) {
  const token = useAccessToken()
  const [section, setSection] = useState('email')
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : undefined

  return (
    <section className="space-y-4 rounded-lg border border-border p-4">
      <div>
        <h2 className="text-sm font-semibold">Template Center</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Manage outbound email content and firma.dev signing layouts. Document masters now live in the{' '}
          <Link href="/admin/works" className="inline-flex items-center gap-0.5 font-medium text-foreground underline underline-offset-2">
            Library <ArrowUpRight className="h-3 w-3" />
          </Link>{' '}
          alongside the firm&apos;s workflows.
        </p>
      </div>
      <Tabs value={section} onValueChange={setSection}>
        <TabsList className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="documents">Document masters</TabsTrigger>
        <TabsList>
          <TabsTrigger value="email">Email</TabsTrigger>
          <TabsTrigger value="esign">E-signature layout</TabsTrigger>
          <TabsTrigger value="clauses">Clause library</TabsTrigger>
        </TabsList>
        <TabsContent value="email"><EmailTemplatesSection authHeaders={authHeaders} /></TabsContent>
        <TabsContent value="esign"><EsignTemplateEditor /></TabsContent>
        <TabsContent value="clauses"><EstateClauseLibrarySection currentUserId={currentUserId} /></TabsContent>
      </Tabs>
    </section>
  )
}
