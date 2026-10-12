import type { ElementType } from 'react'
import {
  Activity,
  AlarmClock,
  Banknote,
  BookOpen,
  Briefcase,
  CalendarDays,
  ContactRound,
  LayoutDashboard,
  ListTodo,
  Mail,
  MessageSquareText,
  ReceiptText,
  Send,
  Settings,
  Sparkles,
  Sun,
  Zap,
} from 'lucide-react'

export type AdminNavGroup = 'Today' | 'Clients' | 'Work' | 'Operations' | 'Tools'

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = ['Today', 'Clients', 'Work', 'Operations', 'Tools']

export const adminNavItems: {
  href: string
  label: string
  icon: ElementType
  group: AdminNavGroup
  exact?: boolean
}[] = [
  // exact: '/admin' is a prefix of every admin route, so it only highlights on itself.
  { href: '/admin', label: 'Today', icon: Sun, group: 'Today', exact: true },
  { href: '/admin/overview', label: 'Overview', icon: LayoutDashboard, group: 'Today' },
  { href: '/admin/crm/opportunities', label: 'Leads', icon: Send, group: 'Clients' },
  { href: '/admin/matters/list', label: 'Matters', icon: Briefcase, group: 'Clients' },
  { href: '/admin/crm/people', label: 'People', icon: ContactRound, group: 'Clients' },
  { href: '/admin/crm/activities', label: 'Activities', icon: Activity, group: 'Clients' },
  { href: '/admin/pipeline/aging', label: 'Aging', icon: AlarmClock, group: 'Clients' },
  { href: '/admin/tasks', label: 'Tasks', icon: ListTodo, group: 'Work' },
  { href: '/admin/calendar', label: 'Calendar', icon: CalendarDays, group: 'Work' },
  { href: '/admin/communications', label: 'Communications', icon: MessageSquareText, group: 'Operations' },
  { href: '/admin/email-triage', label: 'Mail Desk', icon: Mail, group: 'Operations' },
  { href: '/admin/automations', label: 'Automations', icon: Zap, group: 'Operations' },
  { href: '/admin/billing', label: 'Billing', icon: ReceiptText, group: 'Operations' },
  { href: '/admin/payroll', label: 'Payroll', icon: Banknote, group: 'Operations' },
  { href: '/admin/assistant', label: 'Assistant', icon: Sparkles, group: 'Tools' },
  { href: '/admin/works', label: 'Library', icon: BookOpen, group: 'Tools' },
  { href: '/admin/settings', label: 'Settings', icon: Settings, group: 'Tools' },
]
