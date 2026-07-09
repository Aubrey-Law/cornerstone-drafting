'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  Briefcase,
  Clock,
  FilePenLine,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeft,
  Phone,
  Settings,
} from 'lucide-react'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ThemeToggle } from '@/components/ThemeToggle'
import { supabase } from '@/lib/supabaseClient'

const SIDEBAR_COLLAPSED_KEY = 'cornerstone.admin.sidebarCollapsed'

const navItems = [
  { href: '/admin/matters', label: 'Matters', icon: Briefcase },
  { href: '/admin/drafting', label: 'Drafting', icon: FilePenLine },
  { href: '/admin/pipeline/aging', label: 'Aging', icon: Clock },
  { href: '/admin/calls', label: 'Calls', icon: Phone },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
]

interface AdminLayoutClientProps {
  children: React.ReactNode
  userName: string
  userInitials: string
}

export default function AdminLayoutClient({
  children,
  userName,
  userInitials,
}: AdminLayoutClientProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1')
    } catch {
      /* ignore */
    }
  }, [])

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

  const nav = (compact: boolean) => (
    <nav className="flex flex-col gap-1 p-2">
      {navItems.map(item => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMobileOpen(false)}
            title={compact ? item.label : undefined}
            className={cn(
              'flex items-center rounded-md text-sm font-medium transition-colors',
              compact ? 'justify-center px-2 py-2.5' : 'gap-2 px-3 py-2',
              active
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {!compact ? item.label : <span className="sr-only">{item.label}</span>}
          </Link>
        )
      })}
    </nav>
  )

  return (
    <div className="flex min-h-screen bg-background">
      <aside
        className={cn(
          'hidden shrink-0 border-r border-border bg-card transition-[width] duration-200 md:flex md:flex-col',
          collapsed ? 'w-14' : 'w-56',
        )}
      >
        <div
          className={cn(
            'flex h-14 items-center border-b border-border',
            collapsed ? 'justify-center px-1' : 'justify-between gap-1 px-3',
          )}
        >
          {!collapsed ? (
            <Link href="/admin/matters" className="flex min-w-0 items-center gap-2">
              <Image src="/favicon.svg" alt="" width={28} height={28} />
              <span className="truncate text-sm font-semibold">Cornerstone</span>
            </Link>
          ) : (
            <Link href="/admin/matters" className="flex items-center justify-center" title="Cornerstone">
              <Image src="/favicon.svg" alt="" width={24} height={24} />
            </Link>
          )}
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
        </div>
        {nav(collapsed)}
        <div className={cn('mt-auto border-t border-border p-2', collapsed && 'flex justify-center')}>
          <ThemeToggle collapsed={collapsed} variant="sidebar" />
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
          <div className="hidden md:block" />
          <div className="flex items-center gap-2">
            <ThemeToggle variant="default" />
            <div className="hidden text-right sm:block">
              <p className="text-xs font-medium">{userName}</p>
            </div>
            <Avatar className="h-8 w-8">
              <AvatarFallback className="text-xs">{userInitials}</AvatarFallback>
            </Avatar>
            <Button variant="ghost" size="icon" onClick={() => void handleSignOut()} aria-label="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="flex w-56 flex-col p-0">
          <div className="flex h-14 items-center border-b border-border px-4">
            <span className="text-sm font-semibold">Cornerstone</span>
          </div>
          {nav(false)}
          <div className="mt-auto border-t border-border p-2">
            <ThemeToggle variant="sidebar" />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
