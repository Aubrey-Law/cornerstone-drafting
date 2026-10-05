'use client'

import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function PrintKitButton() {
  return (
    <Button type="button" size="sm" onClick={() => window.print()} className="print:hidden">
      <Printer className="size-4" aria-hidden />
      Print kit
    </Button>
  )
}
