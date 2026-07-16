'use client'

import { useState } from 'react'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DocumentTemplatesSection } from './DocumentTemplatesSection'
import { EmailTemplatesSection } from './EmailTemplatesSection'
import { EsignTemplateEditor } from './EsignTemplateEditor'
import { EstateClauseLibrarySection } from './estate-clauses/EstateClauseLibrarySection'

export function TemplateCenter({ currentUserId }: { currentUserId: string }) {
  const token = useAccessToken()
  const [section, setSection] = useState('documents')
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : undefined

  return (
    <section className="space-y-4 rounded-lg border border-border p-4">
      <div>
        <h2 className="text-sm font-semibold">Template Center</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Manage app-owned Word masters, outbound email content, and firma.dev signing layouts from one administrator-only workspace.
        </p>
      </div>
      <Tabs value={section} onValueChange={setSection}>
        <TabsList className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="documents">Document masters</TabsTrigger>
          <TabsTrigger value="email">Email</TabsTrigger>
          <TabsTrigger value="esign">E-signature layout</TabsTrigger>
          <TabsTrigger value="clauses">Clause library</TabsTrigger>
        </TabsList>
        <TabsContent value="documents"><DocumentTemplatesSection /></TabsContent>
        <TabsContent value="email"><EmailTemplatesSection authHeaders={authHeaders} /></TabsContent>
        <TabsContent value="esign"><EsignTemplateEditor /></TabsContent>
        <TabsContent value="clauses"><EstateClauseLibrarySection currentUserId={currentUserId} /></TabsContent>
      </Tabs>
    </section>
  )
}
