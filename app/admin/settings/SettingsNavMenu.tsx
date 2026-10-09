'use client'

import Link from 'next/link'
import { useLayoutEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import { resolveSettingsTab, settingsNavFor, settingsTabHref, type SettingsNavItem } from './settingsNav'
import { navigateSettings, retainSettingsHistoryTracking } from './navigation'

function hrefFor(item: SettingsNavItem): string {
  return item.kind === 'tab' ? settingsTabHref(item.tab) : item.href
}

/**
 * Settings side menu: a grouped vertical list on wide screens, a single select
 * on narrow ones (fifteen entries do not fit across a phone).
 */
export function SettingsNav({ isAdministrator }: { isAdministrator: boolean }) {
  useLayoutEffect(() => retainSettingsHistoryTracking(), [])
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const groups = settingsNavFor(isAdministrator)
  const activeTab = pathname === '/admin/settings' ? resolveSettingsTab(searchParams.get('tab'), isAdministrator) : null

  const isActive = (item: SettingsNavItem) =>
    item.kind === 'tab' ? activeTab === item.tab : pathname === item.href || pathname.startsWith(`${item.href}/`)

  const activeHref = groups.flatMap(g => g.items).find(isActive)
  const selectValue = activeHref ? hrefFor(activeHref) : ''

  return (
    <>
      <div className="md:hidden">
        <label htmlFor="settings-section" className="sr-only">
          Settings section
        </label>
        <select
          id="settings-section"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={selectValue}
          onChange={e => { const destination = e.target.value; navigateSettings(destination, () => router.push(destination), e.currentTarget) }}
        >
          {groups.map(group => (
            <optgroup key={group.label} label={group.label}>
              {group.items.map(item => (
                <option key={hrefFor(item)} value={hrefFor(item)}>
                  {item.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <nav aria-label="Settings" className="hidden md:block">
        <div className="sticky top-4 space-y-5">
          <p className="px-2 text-sm font-semibold">Settings</p>
          {groups.map(group => (
            <div key={group.label}>
              <p className="px-2 text-micro font-medium uppercase tracking-wide text-muted-foreground">
                {group.label}
              </p>
              <ul className="mt-1 space-y-0.5">
                {group.items.map(item => {
                  const active = isActive(item)
                  return (
                    <li key={hrefFor(item)}>
                      <Link
                        href={hrefFor(item)}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'block rounded-md px-2 py-1.5 text-sm',
                          active
                            ? 'bg-selected font-medium text-foreground'
                            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                        )}
                      >
                        {item.label}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>
    </>
  )
}
