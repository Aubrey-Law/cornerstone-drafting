import { MattersSubnav } from '../MattersSubnav'

/**
 * Wraps only the matters overview pages — the dashboard and the list.
 *
 * The route group is what keeps the subnav off `/admin/matters/[id]`: the detail
 * page is a full-bleed layout with its own header and facts rail, and a subnav
 * bar above it would sit oddly and steal vertical space from the rail.
 */
export default function MattersOverviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <MattersSubnav />
      {children}
    </div>
  )
}
