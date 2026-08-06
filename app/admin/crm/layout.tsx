import { CrmSubnav } from './CrmSubnav'

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <CrmSubnav />
      {children}
    </div>
  )
}
