'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  Briefcase,
  BookOpen,
  CalendarDays,
  ChevronDown,
  ClipboardCheck,
  FilePenLine,
  ListTodo,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeft,
  Send,
  ReceiptText,
  Settings,
  Sparkles,
  MailSearch,
  MessageSquareText,
  Sun,
} from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ThemeToggle } from '@/components/ThemeToggle'
import { supabase } from '@/lib/supabaseClient'
import dynamic from 'next/dynamic'
import { AdminRail, RailToggleButton, useAdminRail } from '@/components/rail/AdminRail'
import { useMatterDisplayName } from './components/useMatterDisplayName'
import {
  EMPTY_SIDEBAR_COUNTS,
  mergeSidebarCounts,
  type SidebarCounts,
} from '@/lib/sidebarBadges'
import { SIDEBAR_COUNTS_INVALIDATE_EVENT } from '@/lib/sidebarCountsClient'
import { AdminSidebar } from './components/AdminSidebar'
import { AdminBreadcrumbs } from './components/AdminBreadcrumbs'
import { adminBreadcrumbs } from '@/lib/adminBreadcrumbs'
import { SidebarMattersContext } from '@/lib/matters/SidebarMattersContext'
import { useSidebarMatters } from '@/lib/matters/useSidebarMatters'

const GlobalSearch = dynamic(
  () => import('@/components/GlobalSearch').then(m => ({ default: m.GlobalSearch })),
  { ssr: false },
)

const SIDEBAR_COLLAPSED_KEY = 'cornerstone.admin.sidebarCollapsed'

/**
 * Record-first routes that run the nav as a bare icon rail so the page owns the
 * horizontal budget. `/admin/matters/[id]` only — the design sub-route and the
 * matters list keep the user's own sidebar preference.
 */
// The matter detail page only. `new` and `list` are ordinary full-width pages —
// `list` in particular is the matters list, which needs the expanded sidebar.
const ICON_RAIL_ROUTES = [/^\/admin\/matters\/(?!new$|list$)[^/]+$/]

function isIconRailRoute(pathname: string): boolean {
  return ICON_RAIL_ROUTES.some(pattern => pattern.test(pathname))
}

export type AdminNavGroup = 'Daily' | 'Clients' | 'Work' | 'Finance' | 'Tools'
export const adminNavItems: {
  href: string
  label: string
  icon: React.ElementType
  group: AdminNavGroup
  exact?: boolean
}[] = [
  // exact: '/admin' is a prefix of every admin route, so it only highlights on itself.
  { href: '/admin', label: 'Today', icon: Sun, group: 'Daily', exact: true },
  { href: '/admin/email-triage', label: 'Email triage', icon: MailSearch, group: 'Daily' },
  { href: '/admin/texts', label: 'Texts', icon: MessageSquareText, group: 'Daily' },
  { href: '/admin/crm/opportunities', label: 'Leads', icon: Send, group: 'Clients' },
  { href: '/admin/matters/list', label: 'Matters', icon: Briefcase, group: 'Clients' },
  { href: '/admin/drafting', label: 'Drafting', icon: FilePenLine, group: 'Work' },
  { href: '/admin/review', label: 'Reviews', icon: ClipboardCheck, group: 'Work' },
  // Funding, signing and fiduciaries are worked on the matter (Assets,
  // Documents, People) and field audits on its Reviews tab; their firm-wide
  // worklists open from the Matters dashboard's Close-out card rather than
  // taking four places in the nav. See NAV_SECTION_OWNERS in AdminSidebar.
  { href: '/admin/tasks', label: 'Tasks', icon: ListTodo, group: 'Work' },
  { href: '/admin/calendar', label: 'Calendar', icon: CalendarDays, group: 'Work' },
  { href: '/admin/billing', label: 'Billing', icon: ReceiptText, group: 'Finance' },
  { href: '/admin/assistant', label: 'Assistant', icon: Sparkles, group: 'Tools' },
  { href: '/admin/works', label: 'Library', icon: BookOpen, group: 'Tools' },
  { href: '/admin/settings', label: 'Settings', icon: Settings, group: 'Tools' },
]

const ADMIN_NAV_GROUPS: AdminNavGroup[] = ['Daily', 'Clients', 'Work', 'Finance', 'Tools']

interface AdminLayoutClientProps {
  children: React.ReactNode
  userName: string
  userInitials: string
  assistantModelLabel?: string | null
  /**
   * Forces the compact icon rail and hides the collapse toggle without writing
   * to localStorage, so the user's own preference survives the visit. Left
   * undefined it falls back to the route match — `app/admin/layout.tsx` is a
   * server component and cannot read the pathname to pass this itself.
   */
  forceCollapsed?: boolean
}

export default function AdminLayoutClient({
  children,
  userName,
  userInitials,
  assistantModelLabel = null,
  forceCollapsed,
}: AdminLayoutClientProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [badgeCounts, setBadgeCounts] = useState<SidebarCounts>(EMPTY_SIDEBAR_COUNTS)
  const rail = useAdminRail()
  const matterDisplayName = useMatterDisplayName()
  // Called once and passed to both sidebar instances (desktop column and mobile
  // sheet) so they share one fetch and one view of what is pinned.
  const sidebarMatters = useSidebarMatters()

  useEffect(() => {
    let cancelled = false

    /**
     * Retry a failed refresh quietly, rather than leaving the badges as they
     * are until the next navigation happens to invalidate them.
     *
     * Spaced past the route's own 30s cache on purpose: `unstable_cache` stores
     * a partial failure like any other result, so a retry inside that window
     * would be served the same failure back. The route drops a failed entry
     * now, but the delays hold independently of that.
     *
     * Three attempts and then it stops. The badges are an aid, and a shell that
     * polls a broken endpoint forever is worse than one showing a count marked
     * out of date.
     */
    const RETRY_DELAYS_MS = [4_000, 35_000, 120_000]
    let retryTimer: number | null = null

    function scheduleRetry(attempt: number) {
      if (cancelled || attempt >= RETRY_DELAYS_MS.length) return
      if (retryTimer !== null) window.clearTimeout(retryTimer)
      retryTimer = window.setTimeout(() => {
        retryTimer = null
        void loadBadgeCounts({ fresh: true, attempt: attempt + 1 })
      }, RETRY_DELAYS_MS[attempt])
    }

    async function loadBadgeCounts(opts?: { fresh?: boolean; attempt?: number }) {
      const attempt = opts?.attempt ?? 0
      try {
        const response = await fetch(
          '/api/admin/sidebar-counts',
          opts?.fresh ? { cache: 'no-store' } : undefined,
        )
        if (!response.ok) {
          scheduleRetry(attempt)
          return
        }
        const counts = await response.json() as Partial<SidebarCounts>
        if (cancelled) return
        setBadgeCounts(prev => mergeSidebarCounts(prev, counts))
        // A 200 carrying `errors` is a partial failure: some sections answered
        // and some did not, and the ones that did not are showing a stale
        // count until this succeeds.
        if (counts.errors?.length) scheduleRetry(attempt)
      } catch {
        // Sidebar badges are helpful, not critical to rendering the shell.
        scheduleRetry(attempt)
      }
    }

    let invalidateTimer: number | null = null
    function handleInvalidate() {
      if (invalidateTimer !== null) window.clearTimeout(invalidateTimer)
      invalidateTimer = window.setTimeout(() => {
        invalidateTimer = null
        // A real invalidation restarts the retry budget: something changed, so
        // an endpoint that failed three times is worth asking again.
        void loadBadgeCounts({ fresh: true })
      }, 3000)
    }

    void loadBadgeCounts()
    window.addEventListener(SIDEBAR_COUNTS_INVALIDATE_EVENT, handleInvalidate)
    return () => {
      cancelled = true
      if (invalidateTimer !== null) window.clearTimeout(invalidateTimer)
      if (retryTimer !== null) window.clearTimeout(retryTimer)
      window.removeEventListener(SIDEBAR_COUNTS_INVALIDATE_EVENT, handleInvalidate)
    }
  }, [])

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1')
    } catch {
      /* ignore */
    }
  }, [])

  // `matterDisplayName` is already resolved for the rail, so naming the record
  // in the trail costs no extra request.
  const crumbs = adminBreadcrumbs(pathname, { recordLabel: matterDisplayName })

  const railForced = forceCollapsed ?? isIconRailRoute(pathname)
  // Forced collapse is presentational only — `collapsed` (and localStorage)
  // still holds the preference the user gets back on every other route.
  const compact = railForced || collapsed

  const setSidebarCollapsed = (next: boolean) => {
    setCollapsed(next)
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0')
    } catch {
      /* ignore */
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
    router.refresh()
  }

  return (
    // h-screen + overflow-hidden so <main> owns the scroll and the docked rail
    // can be a full-height column beside it instead of floating over content.
    <SidebarMattersContext.Provider value={sidebarMatters}>
    <div className="flex h-screen overflow-hidden bg-background">
      <aside
        className={cn(
          'hidden shrink-0 border-r border-border bg-card transition-[width] duration-200 md:flex md:flex-col',
          compact ? 'w-14' : 'w-56',
        )}
      >
        <div
          className={cn(
            'flex h-14 items-center border-b border-border',
            compact ? 'justify-center px-1' : 'justify-between gap-1 px-3',
          )}
        >
          {!compact ? (
            <Link href="/admin" className="flex min-w-0 items-center gap-2">
              <Image src="/favicon.svg" alt="" width={28} height={28} />
              <span className="truncate text-sm font-semibold">Cornerstone</span>
            </Link>
          ) : (
            <Link href="/admin" className="flex items-center justify-center" title="Cornerstone">
              <Image src="/favicon.svg" alt="" width={24} height={24} />
            </Link>
          )}
          {!railForced && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => setSidebarCollapsed(!collapsed)}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </Button>
          )}
        </div>
        <AdminSidebar
          pathname={pathname}
          compact={compact}
          badgeCounts={badgeCounts}
          matters={sidebarMatters}
          navItems={adminNavItems}
          navGroups={ADMIN_NAV_GROUPS}
          onNavigate={() => setMobileOpen(false)}
        />
        <div className={cn('mt-auto shrink-0 border-t border-border bg-card p-2', compact && 'flex justify-center')}>
          <ThemeToggle collapsed={compact} variant="sidebar" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-border bg-card px-4">
          <div className="flex items-center gap-2 md:hidden">
            <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)} aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </Button>
            <span className="text-sm font-semibold">Cornerstone</span>
          </div>
          <div className="ml-auto md:ml-0 md:block md:flex-1 md:max-w-md">
            <GlobalSearch />
          </div>
          <div className="hidden min-w-0 md:block md:flex-1">
            <AdminBreadcrumbs crumbs={crumbs} />
          </div>
          <div className="flex items-center gap-2">
            <RailToggleButton rail={rail} />
            <ThemeToggle variant="default" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="h-9 gap-2 px-1.5"
                  aria-label={`Account: ${userName}`}
                >
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="text-xs">{userInitials}</AvatarFallback>
                  </Avatar>
                  <ChevronDown className="hidden size-3.5 text-muted-foreground sm:block" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {/* The name moves in here from the header, where it was text
                    beside the avatar taking horizontal room on every page. */}
                <DropdownMenuLabel className="truncate font-normal">
                  <span className="block text-xs text-muted-foreground">Signed in as</span>
                  <span className="block truncate text-sm font-medium">{userName}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/admin/settings">
                    <Settings className="size-4" aria-hidden />
                    Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => void handleSignOut()}>
                  <LogOut className="size-4" aria-hidden />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 overflow-auto p-4 md:p-6">{children}</main>
          <AdminRail
            rail={rail}
            matterDisplayName={matterDisplayName}
            assistantModelLabel={assistantModelLabel}
            tasksOverdue={badgeCounts.tasksOverdueCount}
          />
        </div>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="flex w-56 flex-col p-0">
          <div className="flex h-14 items-center border-b border-border px-4">
            <SheetTitle className="text-sm font-semibold">Cornerstone</SheetTitle>
            <SheetDescription className="sr-only">Main navigation</SheetDescription>
          </div>
          <AdminSidebar
            pathname={pathname}
            compact={false}
            badgeCounts={badgeCounts}
            matters={sidebarMatters}
            navItems={adminNavItems}
            navGroups={ADMIN_NAV_GROUPS}
            onNavigate={() => setMobileOpen(false)}
          />
          <div className="mt-auto shrink-0 border-t border-border bg-card p-2">
            <ThemeToggle variant="sidebar" />
          </div>
        </SheetContent>
      </Sheet>

    </div>
    </SidebarMattersContext.Provider>
  )
}
