'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  CalendarClock,
  ClipboardList,
  FolderOpen,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  MoreHorizontal,
  ReceiptText,
  ListChecks,
} from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { clientSerifClass } from '@/lib/clientFonts'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { getFirmConfig } from '@/lib/firmConfig'

const firm = getFirmConfig()

// Billing keeps its /account address so existing links and bookmarks work.
const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/intake', label: 'Intake', icon: ClipboardList },
  { href: '/forms', label: 'Forms', icon: ListChecks },
  { href: '/documents', label: 'Documents', icon: FolderOpen },
  { href: '/assets', label: 'Assets', icon: Landmark },
  { href: '/messages', label: 'Messages', icon: MessageSquare },
  { href: '/schedule', label: 'Schedule', icon: CalendarClock },
  { href: '/account', label: 'Billing', icon: ReceiptText },
]

/** Primary destinations on the mobile bottom bar; the rest live under More. */
const MOBILE_PRIMARY = ['/dashboard', '/documents', '/messages'] as const

const navLinkClass = cva(
  'flex min-h-10 items-center gap-3 rounded-md px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar active:scale-[0.99] motion-reduce:active:scale-100',
  {
    variants: {
      active: {
        true: 'bg-sidebar-accent font-medium text-sidebar-accent-foreground shadow-[inset_2px_0_0_0_var(--primary)]',
        false: 'text-sidebar-foreground hover:bg-sidebar-accent',
      },
    },
  },
)

function PortalNavLink({
  item,
  active,
  unreadCount,
  onNavigate,
}: {
  item: (typeof navItems)[number]
  active: boolean
  unreadCount: number
  onNavigate?: () => void
}) {
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
      className={navLinkClass({ active })}
    >
      <item.icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className="flex-1">{item.label}</span>
      {unreadCount > 0 && (
        <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-micro font-semibold tabular-nums text-primary-foreground">
          {unreadCount}
          <span className="sr-only"> unread</span>
        </span>
      )}
    </Link>
  )
}

export default function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

  // Unread firm messages for the nav badge. RLS scopes the query to this
  // client's matter; re-checked on every navigation so visiting /messages
  // (which marks messages read) clears the badge on the next page change.
  useEffect(() => {
    let cancelled = false
    async function loadUnread() {
      try {
        const { count } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('sender_role', 'attorney')
          .is('read_at', null)
        if (!cancelled) setUnreadCount(count ?? 0)
      } catch {
        // The badge is a hint, never worth surfacing an error for.
      }
    }
    void loadUnread()
    return () => {
      cancelled = true
    }
  }, [pathname])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  const primaryMobile = navItems.filter(item =>
    (MOBILE_PRIMARY as readonly string[]).includes(item.href),
  )
  const moreActive = !primaryMobile.some(
    item => pathname === item.href || pathname.startsWith(`${item.href}/`),
  )

  const isCurrent = (href: string) => pathname === href || pathname.startsWith(`${href}/`)

  // h-dvh, not h-screen: on iOS 100vh is the *large* viewport (toolbar hidden),
  // which pushed the sticky message composer behind Safari's bottom toolbar.
  return (
    <div className={cn('client-root flex h-dvh bg-background', clientSerifClass)}>
      <aside className="hidden md:flex w-52 shrink-0 flex-col border-r border-border bg-sidebar">
        <div className="flex h-14 items-center border-b border-sidebar-border px-4">
          <Link
            href="/dashboard"
            className="rounded-sm text-sm font-semibold text-sidebar-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {firm.firmName}
          </Link>
        </div>

        <nav aria-label="Portal" className="flex-1 space-y-0.5 p-2">
          {navItems.map((item) => (
            <PortalNavLink
              key={item.href}
              item={item}
              active={isCurrent(item.href)}
              unreadCount={item.href === '/messages' ? unreadCount : 0}
            />
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-3 text-sidebar-foreground hover:text-sidebar-foreground"
            onClick={handleSignOut}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Sign out
          </Button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-background px-4 md:hidden">
          <Link
            href="/dashboard"
            className="rounded-sm text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {firm.firmName}
          </Link>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-muted-foreground"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-4 w-4" />
          </Button>
        </header>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent
            id="portal-nav-sheet"
            side="left"
            className="w-72 gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground shadow-xl md:hidden sm:max-w-none"
          >
            <SheetTitle className="sr-only">Client portal navigation</SheetTitle>
            <div className="flex h-full flex-col">
              <div className="flex h-14 items-center border-b border-sidebar-border px-4 pr-12">
                <Link
                  href="/dashboard"
                  className="rounded-sm text-sm font-semibold text-sidebar-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setMobileOpen(false)}
                >
                  {firm.firmName}
                </Link>
              </div>
              <nav aria-label="Portal" className="flex-1 space-y-0.5 p-2">
                {navItems.map((item) => (
                  <PortalNavLink
                    key={item.href}
                    item={item}
                    active={isCurrent(item.href)}
                    unreadCount={item.href === '/messages' ? unreadCount : 0}
                    onNavigate={() => setMobileOpen(false)}
                  />
                ))}
              </nav>
              <div className="border-t border-sidebar-border p-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-3 text-sidebar-foreground hover:text-sidebar-foreground"
                  onClick={handleSignOut}
                >
                  <LogOut className="h-4 w-4 shrink-0" />
                  Sign out
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>

        <main className="flex-1 overflow-y-auto pb-16 md:pb-0">{children}</main>

        {/* Mobile bottom bar — primary destinations without opening the sheet. */}
        <nav
          aria-label="Primary"
          className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {primaryMobile.map(item => {
            const isActive = isCurrent(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'relative flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-micro font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-accent',
                  isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {isActive && <span aria-hidden className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-primary" />}
                <item.icon className="size-5" aria-hidden />
                {item.label}
                {item.href === '/messages' && unreadCount > 0 && (
                  <>
                    <span className="absolute right-[22%] top-2 size-1.5 rounded-full bg-primary" aria-hidden />
                    <span className="sr-only">{unreadCount} unread</span>
                  </>
                )}
              </Link>
            )
          })}
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-expanded={mobileOpen}
            aria-controls="portal-nav-sheet"
            aria-haspopup="dialog"
            className={cn(
              'relative flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-micro font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-accent',
              moreActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {moreActive && <span aria-hidden className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-primary" />}
            <MoreHorizontal className="size-5" aria-hidden />
            More
          </button>
        </nav>
      </div>
    </div>
  )
}
