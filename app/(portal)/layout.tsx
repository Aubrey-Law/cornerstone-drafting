import PortalShell from './PortalShell'
import { AuthTokenProvider } from '@/lib/auth/AuthTokenProvider'

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthTokenProvider>
      <PortalShell>{children}</PortalShell>
    </AuthTokenProvider>
  )
}
