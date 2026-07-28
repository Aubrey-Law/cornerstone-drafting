'use client'

import dynamic from 'next/dynamic'

/**
 * The dialer as a rail pane. The floating card and its launcher are gone —
 * `AdminRail` hosts this on its Phone tab and other screens focus it by
 * dispatching `OPEN_STAFF_SOFTPHONE_EVENT`.
 */
export const StaffSoftphonePane = dynamic(() => import('@/components/softphone/Softphone'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Loading phone…
    </div>
  ),
})

// Re-exported so existing callers keep importing the event from here.
export {
  OPEN_STAFF_SOFTPHONE_EVENT,
  openStaffSoftphone,
  type OpenSoftphoneDetail,
} from './softphoneEvents'
