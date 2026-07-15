import { redirect } from 'next/navigation'

// Real estate transfers live in each matter's design sheet (Transfers &
// Assignments section); this legacy URL now lands on the drafting hub.
export default function RealEstateTransferPage() {
  redirect('/admin/drafting')
}
