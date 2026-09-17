'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  CalendarClock,
  ClipboardList,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  ReceiptText,
} from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { getFirmConfig } from '@/lib/firmConfig'

const firm = getFirmConfig()

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/intake', label: 'Intake', icon: ClipboardList },
  { href: '/documents', label: 'Documents', icon: FolderOpen },
  { href: '/account', label: 'Account', icon: ReceiptText },
  { href: '/messages', label: 'Messages', icon: MessageSquare },
  { href: '/schedule', label: 'Schedule', icon: CalendarClock },
]

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

  // h-dvh, not h-screen: on iOS 100vh is the *large* viewport (toolbar hidden),
  // which pushed the sticky message composer behind Safari's bottom toolbar.
  return (
    <div className="flex h-dvh bg-background">
      <aside className="hidden md:flex w-52 shrink-0 flex-col border-r border-border bg-sidebar">
        <div className="flex h-14 items-center border-b border-sidebar-border px-4">
          <Link href="/dashboard" className="text-sm font-semibold text-sidebar-foreground">
            {firm.firmName}
          </Link>
        </div>

        <nav className="flex-1 space-y-1 p-2">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent/50',
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span className="flex-1">{item.label}</span>
                {item.href === '/messages' && unreadCount > 0 && (
                  <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-micro font-semibold tabular-nums text-primary-foreground">
                    {unreadCount}
                  </span>
                )}
              </Link>
            )
          })}
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
          <Link href="/dashboard" className="text-sm font-semibold text-foreground">
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
            side="left"
            className="w-72 gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground md:hidden sm:max-w-none"
          >
            <SheetTitle className="sr-only">Client portal navigation</SheetTitle>
            <div className="flex h-full flex-col">
              <div className="flex h-14 items-center border-b border-sidebar-border px-4 pr-12">
                <Link
                  href="/dashboard"
                  className="text-sm font-semibold text-sidebar-foreground"
                  onClick={() => setMobileOpen(false)}
                >
                  {firm.firmName}
                </Link>
              </div>
              <nav className="flex-1 space-y-1 p-2">
                {navItems.map((item) => {
                  const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        'flex items-center gap-3 rounded px-3 py-2 text-sm transition-colors',
                        isActive
                          ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                          : 'text-sidebar-foreground hover:bg-sidebar-accent/50',
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1">{item.label}</span>
                      {item.href === '/messages' && unreadCount > 0 && (
                        <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-micro font-semibold tabular-nums text-primary-foreground">
                          {unreadCount}
                        </span>
                      )}
                    </Link>
                  )
                })}
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

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}
