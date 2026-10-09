'use client'

import { useId } from 'react'
import type { CompiledIntakeItem } from '@/lib/intake/forms/compiler'
import { CustomQuestionField } from '@/components/forms/CustomQuestionField'
import { CanonicalFieldItem } from './CanonicalFieldItem'
import { INTAKE_BLOCK_RENDERERS, type IntakeBlockRendererProps } from './blockRenderers'

export interface CompiledFormItemProps extends Omit<IntakeBlockRendererProps, 'config'> {
  item: CompiledIntakeItem
  disabled?: boolean
}

/** Dispatch only compiler-approved catalog entries; never evaluate conditions here. */
export function CompiledFormItem({ item, disabled = false, ...props }: CompiledFormItemProps) {
  const helpId = useId()
  switch (item.kind) {
    case 'field':
      return <CanonicalFieldItem item={item} data={props.data} update={props.update} disabled={disabled} />
    case 'block': {
      const Block = INTAKE_BLOCK_RENDERERS[item.blockId]
      return (
        <fieldset disabled={disabled} aria-describedby={item.helpText ? helpId : undefined} className="min-w-0 space-y-3 border-0 p-0">
          {item.title ? <legend className="mb-3 p-0"><h3 className="text-base font-semibold">{item.title}</h3></legend> : null}
          {item.helpText ? <p id={helpId} className="text-sm text-muted-foreground">{item.helpText}</p> : null}
          {item.blockId === 'review_submit' && props.previewReview !== undefined ? props.previewReview : <Block
            {...props}
            disabled={disabled}
            config={item.config}
            update={(field, value) => { if (!disabled) props.update(field, value) }}
            onAttorneySave={disabled ? undefined : props.onAttorneySave}
          />}
        </fieldset>
      )
    }
    case 'question': {
      const value = props.data[item.id]
      return <CustomQuestionField question={item} value={typeof value === 'string' || Array.isArray(value) ? value as string | string[] : null} disabled={disabled} onChange={next => { if (!disabled) props.update(item.id, next) }} />
    }
    default: {
      const unreachable: never = item
      throw new Error(`Unsupported compiled intake item: ${JSON.stringify(unreachable)}`)
    }
  }
}
