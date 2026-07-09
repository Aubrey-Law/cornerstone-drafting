'use client'

import {
  getWillPersonalRepresentativePowers,
  setWillPersonalRepresentativePowers,
} from '@/lib/designSheetWillPowers'
import {
  DesignSheetCheckboxOption,
  SectionBlock,
  type SectionProps,
} from './shared'

export function WillPersonalRepresentativePowersSection({ sheet, onChange }: SectionProps) {
  const powers = getWillPersonalRepresentativePowers(sheet)

  const updatePowers = (patch: Parameters<typeof setWillPersonalRepresentativePowers>[1]) => {
    onChange('decisions', setWillPersonalRepresentativePowers(sheet, patch))
  }

  return (
    <SectionBlock title="Personal Representative Powers">
      <div className="space-y-3">
        <DesignSheetCheckboxOption
          label="Allow executor to pay taxes, debts, and expenses"
          description="Authorizes the executor to pay estate taxes, debts, expenses of last illness, and costs of administration from the probate estate if not paid by the trust."
          checked={powers.allow_pay_taxes_debts_expenses}
          onChange={checked => updatePowers({ allow_pay_taxes_debts_expenses: checked })}
        />
        <DesignSheetCheckboxOption
          label="Allow executor to manage digital assets"
          description="Authorizes the executor to access, manage, and dispose of digital devices, accounts, and assets under the Revised Uniform Fiduciary Access to Digital Assets Act."
          checked={powers.allow_manage_digital_assets}
          onChange={checked => updatePowers({ allow_manage_digital_assets: checked })}
        />
        <DesignSheetCheckboxOption
          label={'Include "Distribution in Cash or Kind" Power'}
          description="Authorizes the executor to sell or lease estate property and distribute assets in cash or in kind at their discretion."
          checked={powers.include_distribution_cash_or_kind}
          onChange={checked => updatePowers({ include_distribution_cash_or_kind: checked })}
        />
      </div>
    </SectionBlock>
  )
}
