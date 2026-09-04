import { Button } from '@aubrey-law/ui/button'

/** A form, not a link: sign-out is POST only (see app/auth/sign-out/route.ts). */
export function SignOutButton() {
  return (
    <form action="/auth/sign-out" method="post">
      <Button type="submit" variant="outline" size="sm">
        Sign out
      </Button>
    </form>
  )
}
