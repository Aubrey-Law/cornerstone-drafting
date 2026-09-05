import { describe, expect, it } from 'vitest'
import { CLIENT_HOME, STAFF_HOME, decide } from '@/lib/auth/gate'

const noSession = { userId: null, role: null }
const staff = { userId: 'u-attorney', role: 'attorney' as string | null }
const admin = { userId: 'u-admin', role: 'admin' as string | null }
const client = { userId: 'u-client', role: 'client' as string | null }
const roleless = { userId: 'u-new', role: null }

/**
 * The whole access-control decision, as a pure function of the path and who is
 * asking. Kept pure precisely so the security rules can be enumerated as a
 * table rather than asserted through a mocked Supabase client — the table is
 * the specification, and a reader can check it against intent line by line.
 */
describe('auth gate', () => {
  describe('paths served without a session', () => {
    it.each(['/auth/login', '/auth/sign-out', '/api/health'])('%s passes anonymously', (pathname) => {
      expect(decide({ pathname, ...noSession })).toEqual({ kind: 'pass' })
    })

    it('passes an unrecognised path so Next can answer 404', () => {
      // Redirecting an unknown path to login would tell an anonymous caller
      // which paths exist by which ones bounce.
      expect(decide({ pathname: '/nope', ...noSession })).toEqual({ kind: 'pass' })
    })
  })

  describe('no session', () => {
    it.each(['/', '/matters', '/matters/abc-123', '/tasks', '/library', '/settings'])(
      'denies staff path %s with 401',
      (pathname) => {
        expect(decide({ pathname, ...noSession })).toEqual({ kind: 'deny', status: 401 })
      },
    )

    it.each(['/portal', '/portal/documents'])('denies client path %s with 401', (pathname) => {
      expect(decide({ pathname, ...noSession })).toEqual({ kind: 'deny', status: 401 })
    })

    it.each(['/api/staff/matters', '/api/portal/documents'])('denies API path %s with 401', (pathname) => {
      expect(decide({ pathname, ...noSession })).toEqual({ kind: 'deny', status: 401 })
    })
  })

  describe('staff surface', () => {
    it.each([staff, admin])('admits role $role', (session) => {
      expect(decide({ pathname: '/matters', ...session })).toEqual({ kind: 'pass' })
    })

    it('sends a client to their own home rather than denying', () => {
      expect(decide({ pathname: '/matters', ...client })).toEqual({ kind: 'redirect', to: CLIENT_HOME })
    })

    it('answers a client calling a staff API with 403, not a redirect', () => {
      // The caller is authenticated and simply not allowed. 401 would tell a
      // fetch to re-authenticate, which cannot help.
      expect(decide({ pathname: '/api/staff/matters', ...client })).toEqual({ kind: 'deny', status: 403 })
    })

    it('denies a session whose role never resolved', () => {
      expect(decide({ pathname: '/', ...roleless })).toEqual({ kind: 'deny', status: 401 })
    })

    /**
     * `/prompts` runs a field-audit prompt against a matter's design sheet —
     * a practice tool exactly like `/review` or `/matters`, gated the same
     * way for the same reason.
     */
    it('gates /prompts behind staff, like every other practice tool', () => {
      expect(decide({ pathname: '/prompts', ...noSession })).toEqual({ kind: 'deny', status: 401 })
      expect(decide({ pathname: '/prompts', ...client })).toEqual({ kind: 'redirect', to: CLIENT_HOME })
      expect(decide({ pathname: '/prompts', ...staff })).toEqual({ kind: 'pass' })
    })
  })

  describe('client surface', () => {
    it('admits a client', () => {
      expect(decide({ pathname: '/portal/documents', ...client })).toEqual({ kind: 'pass' })
    })

    it('sends staff to the staff home', () => {
      expect(decide({ pathname: '/portal', ...staff })).toEqual({ kind: 'redirect', to: STAFF_HOME })
    })

    it('answers staff calling a portal API with 403', () => {
      expect(decide({ pathname: '/api/portal/documents', ...staff })).toEqual({ kind: 'deny', status: 403 })
    })
  })

  describe('the login page with a live session', () => {
    it('sends staff to the staff home', () => {
      expect(decide({ pathname: '/auth/login', ...staff })).toEqual({ kind: 'redirect', to: STAFF_HOME })
    })

    it('sends a client to the client home', () => {
      expect(decide({ pathname: '/auth/login', ...client })).toEqual({ kind: 'redirect', to: CLIENT_HOME })
    })

    it('honours a redirectTo the role is allowed to reach', () => {
      expect(decide({ pathname: '/auth/login', redirectTo: '/matters/abc-123', ...staff })).toEqual({
        kind: 'redirect',
        to: '/matters/abc-123',
      })
    })

    it('ignores a redirectTo belonging to the other audience', () => {
      expect(decide({ pathname: '/auth/login', redirectTo: '/portal', ...staff })).toEqual({
        kind: 'redirect',
        to: STAFF_HOME,
      })
    })

    it('ignores an off-site redirectTo', () => {
      expect(decide({ pathname: '/auth/login', redirectTo: '//evil.example', ...staff })).toEqual({
        kind: 'redirect',
        to: STAFF_HOME,
      })
    })

    /**
     * The loop this prevents: a signed-in user with no role has no home to be
     * sent to. Redirecting them anywhere lands on a gated path, which denies
     * back to the login page, which redirects again. Passing lets the page
     * render and say what is wrong.
     */
    it('renders the login page for a session with no role, rather than looping', () => {
      expect(decide({ pathname: '/auth/login', ...roleless })).toEqual({ kind: 'pass' })
    })
  })
})
