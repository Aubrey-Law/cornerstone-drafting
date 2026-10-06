# Signing from the portal

The native e-sign engine (`lib/esign/`) signs a PDF: mint a token, show the document, record
consent, stamp the marks, keep an append-only audit trail, seal and file. A signature request
or engagement agreement is sent to named recipients, and each recipient's emailed link
(`/sign/[token]`) is their credential.

A client who is signed in to the portal has a second credential: their account. The portal
lets them sign the sessions addressed to the email they sign in with, without the token.

## What the client sees

- **Dashboard.** "Ready for your signature" lists what awaits a signature on their matter,
  their own items first, then anyone else's (a spouse's, usually) as a "Waiting for … to sign"
  line. "What's next" puts a signature the firm is waiting on ahead of everything but the
  intake, with "Review and sign" going straight to the one item or to the list.
- **Documents.** The same list at the top of the page (`#sign`), each own item with "Review
  and sign".
- **Signing** (`/documents/sign/[sessionId]`). The same experience the emailed link opens
  (`components/esign/SigningExperience`): the full PDF, the consent disclosure, a typed or
  drawn signature, decline as a first-class outcome. Afterwards, back to Documents, where the
  executed copy appears once everyone has signed.

## How it is held together

- `lib/esign/signingFlow.ts` is the signing itself: `openSigningSession` and `submitSigning`.
  Both doors run it. `app/api/sign/[token]` resolves the token to a session (hash lookup, rate
  limited); `app/api/documents/sign/[sessionId]` resolves the signed-in client instead:
  bearer user → their hired matter → `resolvePortalSigningSession`, which checks that the
  session exists, that what it signs belongs to that matter, and that the recipient it was
  sent to is the client's email, then applies the same open/closed gate the token route does.
  A session that is not theirs reads exactly like one that does not exist.
- `lib/portal/signatures.ts` (pure) says which sessions are the client's, how an item is
  titled and described, and where "Review and sign" goes. `lib/portal/signaturesServer.ts`
  reads the engine's own rows (agreements, requests, recipients, sessions): there is one state
  for a signature however it is reached.
- A signed **document** (signature request) is now shared to the portal when it completes,
  with the usual "a document is ready" notice, as the signed engagement agreement already
  was. The signer was just told a copy is kept in their matter; it is.
- The lifecycle's engagement requirement (`matter.engagement_signed`) applies whenever the
  firm signs engagements through the app: through Firma (its env vars) or natively (the
  `esign_native_enabled` firm setting). It used to switch itself off for a firm that had moved
  to native signing.

## Not in this slice

The emailed signing link still points at `/sign/[token]`; a client without a portal account
signs exactly as before. Reminders for unsigned requests are still sent by hand (Resend on the
Documents tab). Retiring the Firma provider is a separate step once native signing has carried
the firm's engagements for a while.
