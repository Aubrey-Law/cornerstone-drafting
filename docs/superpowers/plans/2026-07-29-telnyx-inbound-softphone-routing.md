# Telnyx Inbound Softphone Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ring Scott's existing Telnyx browser softphone for 25 seconds and then forward declined, offline, failed, or unanswered calls to `+13392381012`.

**Architecture:** Keep the existing credential connection and generated credential for WebRTC registration and outbound calls. Assign the firm's number to a Telnyx TeXML application whose inbound URL returns a sequential `<Dial>` for Scott's SIP URI followed by the fallback number; separately replace the incompatible webhook SDK unwrap path with direct Ed25519 verification over the raw Telnyx payload.

**Tech Stack:** Next.js 16 App Router, TypeScript 5.7, Node.js crypto, Telnyx TeXML, Telnyx WebRTC, Vitest 4, Vercel

## Global Constraints

- Scott is the only staff user.
- Preserve the existing generated-credential JWT flow and outbound calling behavior.
- Ring Scott for exactly 25 seconds before trying `+13392381012`.
- Use `answerOnBridge` so the caller is not answered before a destination answers.
- Do not expose the Telnyx API key or SIP password to the browser.
- Do not modify Cornerstone drafting internals.
- Keep Twilio as an unaffected rollback provider.

---

## File Structure

- Create `lib/telnyx/inbound.ts`: validate inbound routing environment and build deterministic, escaped TeXML.
- Create `app/api/voice/telnyx/inbound/route.ts`: serve the fixed TeXML document for Telnyx GET or POST requests.
- Modify `lib/telnyx/client.ts`: verify Telnyx Ed25519 callbacks against the exact raw body before parsing JSON.
- Modify `lib/telnyx/config.ts`: report inbound voice readiness without hiding the otherwise-working outbound softphone.
- Modify `tests/telnyx-communications.test.ts`: cover TeXML routing, configuration, and real Ed25519 verification.
- Modify `VERCEL_ENV_CHECKLIST.md`: document the inbound SIP URI and TeXML application setup.

### Task 1: Deterministic inbound TeXML route

**Files:**
- Create: `lib/telnyx/inbound.ts`
- Create: `app/api/voice/telnyx/inbound/route.ts`
- Modify: `tests/telnyx-communications.test.ts`

**Interfaces:**
- Produces: `telnyxInboundRouteConfig(): TelnyxInboundRouteConfig | null`
- Produces: `buildTelnyxInboundTexml(config: TelnyxInboundRouteConfig | null): string`
- Produces: `GET(): Response` and `POST(): Response` route handlers with `Content-Type: text/xml; charset=utf-8`

- [ ] **Step 1: Write failing configuration and TeXML tests**

Add imports:

```ts
import {
  buildTelnyxInboundTexml,
  telnyxInboundRouteConfig,
} from '@/lib/telnyx/inbound'
import { GET as getTelnyxInboundTexml } from '@/app/api/voice/telnyx/inbound/route'
```

Add tests with literal expected behavior:

```ts
it('routes inbound calls to Scott for 25 seconds before the fallback number', () => {
  const xml = buildTelnyxInboundTexml({
    agentSipUri: 'sip:gencredScott@sip.telnyx.com',
    fallbackDestination: '+13392381012',
    ringTimeoutSeconds: 25,
  })

  expect(xml).toBe(
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Response><Dial answerOnBridge="true" sequential="true" timeout="25">' +
    '<Sip>sip:gencredScott@sip.telnyx.com</Sip>' +
    '<Number>+13392381012</Number>' +
    '</Dial></Response>',
  )
  expect(xml.indexOf('<Sip>')).toBeLessThan(xml.indexOf('<Number>'))
})

it('escapes configured TeXML destinations', () => {
  const xml = buildTelnyxInboundTexml({
    agentSipUri: 'sip:agent&desk@sip.telnyx.com',
    fallbackDestination: '+13392381012',
    ringTimeoutSeconds: 25,
  })
  expect(xml).toContain('<Sip>sip:agent&amp;desk@sip.telnyx.com</Sip>')
})

it('returns a safe hangup document when inbound routing is incomplete', () => {
  expect(buildTelnyxInboundTexml(null)).toBe(
    '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
  )
})

it('reads and validates inbound routing configuration', () => {
  vi.stubEnv('TELNYX_INBOUND_AGENT_SIP_URI', 'sip:gencredScott@sip.telnyx.com')
  vi.stubEnv('TELNYX_INBOUND_FALLBACK_DESTINATION', '+13392381012')
  vi.stubEnv('TELNYX_INBOUND_RING_TIMEOUT', '25')
  expect(telnyxInboundRouteConfig()).toEqual({
    agentSipUri: 'sip:gencredScott@sip.telnyx.com',
    fallbackDestination: '+13392381012',
    ringTimeoutSeconds: 25,
  })
})

it('serves inbound TeXML without caching', () => {
  vi.stubEnv('TELNYX_INBOUND_AGENT_SIP_URI', 'sip:gencredScott@sip.telnyx.com')
  vi.stubEnv('TELNYX_INBOUND_FALLBACK_DESTINATION', '+13392381012')
  vi.stubEnv('TELNYX_INBOUND_RING_TIMEOUT', '25')
  const response = getTelnyxInboundTexml()
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('text/xml; charset=utf-8')
  expect(response.headers.get('cache-control')).toBe('no-store')
})
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npx vitest run tests/telnyx-communications.test.ts
```

Expected: FAIL because `@/lib/telnyx/inbound` does not exist.

- [ ] **Step 3: Implement the minimal TeXML builder**

Create `lib/telnyx/inbound.ts` with:

```ts
export interface TelnyxInboundRouteConfig {
  agentSipUri: string
  fallbackDestination: string
  ringTimeoutSeconds: number
}

const DEFAULT_RING_TIMEOUT_SECONDS = 25
const MIN_RING_TIMEOUT_SECONDS = 5
const MAX_RING_TIMEOUT_SECONDS = 600

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function telnyxInboundRouteConfig(): TelnyxInboundRouteConfig | null {
  const agentSipUri = process.env.TELNYX_INBOUND_AGENT_SIP_URI?.trim()
  const fallbackDestination = process.env.TELNYX_INBOUND_FALLBACK_DESTINATION?.trim()
  if (!agentSipUri || !fallbackDestination) return null
  if (!/^sip:[^\s]+@[^\s]+$/i.test(agentSipUri)) return null
  if (!/^\+[1-9]\d{7,14}$/.test(fallbackDestination)) return null

  const parsedTimeout = Number.parseInt(process.env.TELNYX_INBOUND_RING_TIMEOUT ?? '', 10)
  const ringTimeoutSeconds = Number.isFinite(parsedTimeout)
    ? Math.min(MAX_RING_TIMEOUT_SECONDS, Math.max(MIN_RING_TIMEOUT_SECONDS, parsedTimeout))
    : DEFAULT_RING_TIMEOUT_SECONDS

  return { agentSipUri, fallbackDestination, ringTimeoutSeconds }
}

export function buildTelnyxInboundTexml(config: TelnyxInboundRouteConfig | null): string {
  const declaration = '<?xml version="1.0" encoding="UTF-8"?>'
  if (!config) return `${declaration}<Response><Hangup/></Response>`
  return declaration +
    `<Response><Dial answerOnBridge="true" sequential="true" timeout="${config.ringTimeoutSeconds}">` +
    `<Sip>${escapeXml(config.agentSipUri)}</Sip>` +
    `<Number>${escapeXml(config.fallbackDestination)}</Number>` +
    '</Dial></Response>'
}
```

- [ ] **Step 4: Add the Next.js route**

Create `app/api/voice/telnyx/inbound/route.ts`:

```ts
import { buildTelnyxInboundTexml, telnyxInboundRouteConfig } from '@/lib/telnyx/inbound'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function response(): Response {
  const config = telnyxInboundRouteConfig()
  if (!config) console.error('Telnyx inbound routing is not configured')
  return new Response(buildTelnyxInboundTexml(config), {
    status: 200,
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

export const GET = response
export const POST = response
```

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run:

```bash
npx vitest run tests/telnyx-communications.test.ts
```

Expected: all tests in the file pass.

- [ ] **Step 6: Commit the TeXML route**

```bash
git add lib/telnyx/inbound.ts app/api/voice/telnyx/inbound/route.ts tests/telnyx-communications.test.ts
git commit -m "Add Telnyx inbound softphone routing"
```

### Task 2: Correct Telnyx Ed25519 webhook verification

**Files:**
- Modify: `lib/telnyx/client.ts`
- Modify: `tests/telnyx-communications.test.ts`

**Interfaces:**
- Produces: `verifyTelnyxWebhookSignature(rawBody: string, signature: string, timestamp: string, publicKey: string, nowSeconds?: number): void`
- Preserves: `unwrapTelnyxWebhook<T>(req: Request, rawBody: string): Promise<T>`

- [ ] **Step 1: Write failing tests using a real Ed25519 key pair**

Add Node crypto imports:

```ts
import { generateKeyPairSync, sign } from 'node:crypto'
import {
  unwrapTelnyxWebhook,
  verifyTelnyxWebhookSignature,
} from '@/lib/telnyx/client'
```

Add a helper that exports the final 32 raw Ed25519 public-key bytes from the SPKI document:

```ts
function signedTelnyxFixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const rawPublicKey = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const rawBody = '{"data":{"id":"event-1","event_type":"call.initiated","payload":{}}}'
  const signature = sign(
    null,
    Buffer.from(`${timestamp}|${rawBody}`),
    privateKey,
  ).toString('base64')
  return { rawBody, signature, timestamp, publicKey: rawPublicKey.toString('base64') }
}
```

Add tests:

```ts
it('accepts an authentic Telnyx Ed25519 webhook', async () => {
  const fixture = signedTelnyxFixture()
  vi.stubEnv('TELNYX_API_KEY', 'KEY_TEST')
  vi.stubEnv('TELNYX_PUBLIC_KEY', fixture.publicKey)
  const request = new Request('https://example.test/webhook', {
    method: 'POST',
    headers: {
      'telnyx-signature-ed25519': fixture.signature,
      'telnyx-timestamp': fixture.timestamp,
    },
    body: fixture.rawBody,
  })
  await expect(unwrapTelnyxWebhook(request, fixture.rawBody)).resolves.toMatchObject({
    data: { id: 'event-1', event_type: 'call.initiated' },
  })
})

it('rejects a changed Telnyx webhook payload', () => {
  const fixture = signedTelnyxFixture()
  expect(() => verifyTelnyxWebhookSignature(
    `${fixture.rawBody} `,
    fixture.signature,
    fixture.timestamp,
    fixture.publicKey,
  )).toThrow('Invalid Telnyx webhook signature')
})

it('rejects a stale Telnyx webhook timestamp', () => {
  const fixture = signedTelnyxFixture()
  expect(() => verifyTelnyxWebhookSignature(
    fixture.rawBody,
    fixture.signature,
    fixture.timestamp,
    fixture.publicKey,
    Number(fixture.timestamp) + 301,
  )).toThrow('Telnyx webhook timestamp is outside the allowed tolerance')
})

it('rejects a Telnyx webhook with missing signature headers', async () => {
  const fixture = signedTelnyxFixture()
  vi.stubEnv('TELNYX_PUBLIC_KEY', fixture.publicKey)
  const request = new Request('https://example.test/webhook', {
    method: 'POST',
    body: fixture.rawBody,
  })
  await expect(unwrapTelnyxWebhook(request, fixture.rawBody))
    .rejects.toThrow('Missing Telnyx webhook signature headers')
})
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npx vitest run tests/telnyx-communications.test.ts
```

Expected: FAIL because `verifyTelnyxWebhookSignature` is not exported and the existing SDK unwrap rejects valid Telnyx headers.

- [ ] **Step 3: Implement native Ed25519 verification**

Modify `lib/telnyx/client.ts` to import:

```ts
import { createPublicKey, verify } from 'node:crypto'
```

Add:

```ts
const TELNYX_WEBHOOK_TOLERANCE_SECONDS = 300
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

export function verifyTelnyxWebhookSignature(
  rawBody: string,
  signature: string,
  timestamp: string,
  publicKey: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): void {
  if (!signature || !timestamp) throw new Error('Missing Telnyx webhook signature headers')
  const timestampSeconds = Number(timestamp)
  if (!Number.isInteger(timestampSeconds)) throw new Error('Invalid Telnyx webhook timestamp')
  if (Math.abs(nowSeconds - timestampSeconds) > TELNYX_WEBHOOK_TOLERANCE_SECONDS) {
    throw new Error('Telnyx webhook timestamp is outside the allowed tolerance')
  }

  const rawPublicKey = Buffer.from(publicKey, 'base64')
  if (rawPublicKey.length !== 32) throw new Error('Invalid Telnyx public key')
  const signatureBytes = Buffer.from(signature, 'base64')
  if (signatureBytes.length !== 64) throw new Error('Invalid Telnyx webhook signature')
  const key = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, rawPublicKey]),
    format: 'der',
    type: 'spki',
  })
  const valid = verify(
    null,
    Buffer.from(`${timestamp}|${rawBody}`),
    key,
    signatureBytes,
  )
  if (!valid) throw new Error('Invalid Telnyx webhook signature')
}
```

Replace the SDK `webhooks.unwrap` call in `unwrapTelnyxWebhook` with:

```ts
verifyTelnyxWebhookSignature(rawBody, signature, timestamp, publicKey)
return JSON.parse(rawBody) as T
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
npx vitest run tests/telnyx-communications.test.ts
```

Expected: all Telnyx communication tests pass.

- [ ] **Step 5: Run webhook authorization regression tests**

Run:

```bash
npx vitest run tests/telnyx-communications.test.ts tests/api-route-auth.test.ts tests/webhook-idempotency.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 6: Commit webhook verification**

```bash
git add lib/telnyx/client.ts tests/telnyx-communications.test.ts
git commit -m "Fix Telnyx webhook signature verification"
```

### Task 3: Configuration readiness and operator documentation

**Files:**
- Modify: `lib/telnyx/config.ts`
- Modify: `tests/telnyx-communications.test.ts`
- Modify: `VERCEL_ENV_CHECKLIST.md`

**Interfaces:**
- Produces: `inboundVoiceConfigured: boolean` in `telnyxConfigStatus()`
- Produces: `missing.inboundVoice: string[]` in `telnyxConfigStatus()`
- Does not change: `isTelnyxVoiceConfigured()` outbound softphone readiness

- [ ] **Step 1: Write the failing readiness test**

Add:

```ts
import { telnyxConfigStatus } from '@/lib/telnyx/config'
```

Add:

```ts
it('reports inbound voice configuration separately from outbound voice', () => {
  vi.stubEnv('TELNYX_INBOUND_AGENT_SIP_URI', 'sip:gencredScott@sip.telnyx.com')
  vi.stubEnv('TELNYX_INBOUND_FALLBACK_DESTINATION', '+13392381012')
  vi.stubEnv('TELNYX_INBOUND_RING_TIMEOUT', '25')
  expect(telnyxConfigStatus()).toMatchObject({
    inboundVoiceConfigured: true,
    missing: { inboundVoice: [] },
    webhooks: {
      inboundTeXML: expect.stringContaining('/api/voice/telnyx/inbound'),
    },
  })
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run tests/telnyx-communications.test.ts
```

Expected: FAIL because `inboundVoiceConfigured`, `missing.inboundVoice`, and `webhooks.inboundTeXML` do not exist.

- [ ] **Step 3: Add inbound readiness without changing outbound readiness**

Modify `telnyxConfigStatus()`:

```ts
const inboundMissing = missing([
  'TELNYX_INBOUND_AGENT_SIP_URI',
  'TELNYX_INBOUND_FALLBACK_DESTINATION',
])
```

Return:

```ts
inboundVoiceConfigured: inboundMissing.length === 0,
missing: {
  // existing sms and voice entries
  inboundVoice: inboundMissing,
},
webhooks: {
  // existing messaging and voice entries
  inboundTeXML: `${telnyxAppBaseUrl()}/api/voice/telnyx/inbound`,
},
```

- [ ] **Step 4: Update the deployment checklist**

Add `TELNYX_INBOUND_AGENT_SIP_URI` to the Telnyx environment table. Clarify that:

- `TELNYX_CONNECTION_ID` remains the credential connection for Scott's JWT.
- the number must be assigned to a TeXML application;
- the TeXML application's Voice URL is `/api/voice/telnyx/inbound`;
- its event callback URL is `/api/webhooks/telnyx/voice`;
- `TELNYX_INBOUND_RING_TIMEOUT=25`;
- `TELNYX_INBOUND_FALLBACK_DESTINATION=+13392381012`.

- [ ] **Step 5: Verify focused tests and documentation diff**

Run:

```bash
npx vitest run tests/telnyx-communications.test.ts
git diff --check
```

Expected: tests pass and `git diff --check` exits 0.

- [ ] **Step 6: Commit configuration readiness**

```bash
git add lib/telnyx/config.ts tests/telnyx-communications.test.ts VERCEL_ENV_CHECKLIST.md
git commit -m "Document Telnyx inbound voice configuration"
```

### Task 4: Full focused verification and production rollout

**Files:**
- Verify all changed files.
- Change Vercel production environment variables.
- Change the Telnyx portal Voice Application and number assignment.

**Interfaces:**
- Consumes: production route `/api/voice/telnyx/inbound`
- Consumes: production route `/api/webhooks/telnyx/voice`
- Produces: live inbound ringing and fallback behavior

- [ ] **Step 1: Run the complete focused verification set**

Run:

```bash
npx vitest run \
  tests/telnyx-communications.test.ts \
  tests/softphone-popup.test.tsx \
  tests/softphone-rail-pane.test.tsx \
  tests/api-route-auth.test.ts \
  tests/webhook-idempotency.test.ts
npx eslint \
  lib/telnyx/client.ts \
  lib/telnyx/config.ts \
  lib/telnyx/inbound.ts \
  app/api/voice/telnyx/inbound/route.ts \
  tests/telnyx-communications.test.ts
npm run typecheck
git diff --check
```

Expected: focused tests and changed-file ESLint pass; typecheck is evaluated against the repository's documented baseline failures without treating unrelated `tests/*.test.ts` errors as regressions.

- [ ] **Step 2: Review the final source and history**

Run:

```bash
git status -sb
git diff origin/main...HEAD --stat
git diff origin/main...HEAD
```

Confirm the diff contains only the approved inbound Telnyx routing, verification, readiness, tests, and documentation.

- [ ] **Step 3: Push the implementation**

Run:

```bash
git push origin main
```

Expected: the new commits are accepted and the production deployment begins.

- [ ] **Step 4: Configure Vercel production**

Set:

```text
TELNYX_INBOUND_AGENT_SIP_URI=sip:gencredjEk3vUT63zmO3jSdGMWCDzKk5OzKUOAoUkomgBgGVX@sip.telnyx.com
TELNYX_INBOUND_RING_TIMEOUT=25
TELNYX_INBOUND_FALLBACK_DESTINATION=+13392381012
```

Redeploy the exact pushed commit so the new environment revision is active.

- [ ] **Step 5: Configure Telnyx**

In Mission Control:

1. Create or select a TeXML application.
2. Set the Voice URL to `https://cornerstone.aubreylegal.com/api/voice/telnyx/inbound` using POST.
3. Set the event callback URL to `https://cornerstone.aubreylegal.com/api/webhooks/telnyx/voice`.
4. Select API v2 webhook format.
5. Assign the firm's Telnyx number to the TeXML application.
6. Leave Scott's generated credential and its parent credential connection intact.

- [ ] **Step 6: Verify production endpoints**

Confirm:

```text
GET /api/token -> 200 while Scott is authenticated
POST /api/webhooks/telnyx/voice -> 200 for authentic Telnyx callbacks
GET /api/voice/telnyx/inbound -> 200 and Content-Type text/xml
```

Use Vercel runtime logs to confirm the prior repeated webhook 401 responses stop.

- [ ] **Step 7: Perform the two live call tests**

1. Call the firm number with Scott logged in; confirm the browser rings and audio works after Answer.
2. Call again and decline; confirm `+13392381012` rings.
3. Call again without answering; confirm `+13392381012` rings after 25 seconds.

- [ ] **Step 8: Report deployment evidence**

Record:

- pushed commit SHA;
- Vercel deployment ID and READY state;
- webhook response status;
- answered-browser call result;
- declined-call fallback result;
- unanswered-call fallback result.
