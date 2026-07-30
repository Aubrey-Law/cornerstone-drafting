# Telnyx Inbound Softphone Routing

Date: 2026-07-29

## Goal

Make calls to the firm's Telnyx number ring Scott's existing Cornerstone browser softphone. If Scott declines the call, is offline, or does not answer within 25 seconds, route the caller to `+13392381012`.

Outbound calling and Scott's existing short-lived Telnyx JWT login must continue to work.

## Current Failure

The browser successfully receives a Telnyx JWT for Scott's generated telephony credential, but the firm's number is attached to a credential connection. Telnyx does not route a PSTN call directly to an on-demand generated credential.

The production voice webhook also rejects legitimate Telnyx callbacks. The application passes Telnyx's Ed25519 headers into an SDK path that expects Standard Webhooks HMAC headers, so every callback returns HTTP 401. The route only records events after verification; it does not create an inbound leg to Scott's generated credential.

## Selected Architecture

Use a Telnyx Programmable Voice application for the firm's number while retaining the existing credential connection for Scott's WebRTC registration and outbound calls.

The Programmable Voice application will request TeXML from Cornerstone. The TeXML response will use a sequential `Dial`:

1. Dial Scott's generated SIP username for 25 seconds.
2. If that attempt is declined, busy, offline, fails, or times out, dial `+13392381012`.
3. Use `answerOnBridge` so the original caller continues hearing ringing until one destination answers.

TeXML is the smallest Call Control implementation for this single-user firm. Telnyx performs the leg creation, bridging, decline handling, and sequential fallback, avoiding a custom distributed call-state machine in the application.

## Configuration

Keep:

- `TELNYX_CONNECTION_ID`: Scott's credential connection, used for WebRTC/JWT operations.
- `TELNYX_TELEPHONY_CREDENTIAL_IDS`: existing user-to-credential mapping.
- `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY`, and `TELNYX_PHONE_NUMBER`.

Add:

- `TELNYX_INBOUND_AGENT_SIP_URI`: Scott's generated credential URI, in the form `sip:gencred...@sip.telnyx.com`.
- `TELNYX_INBOUND_RING_TIMEOUT`: `25`.
- `TELNYX_INBOUND_FALLBACK_DESTINATION`: `+13392381012`.

Telnyx portal:

- Create a TeXML/Programmable Voice application.
- Set its inbound TeXML URL to the production Cornerstone inbound route.
- Set its event callback URL to the existing Telnyx voice webhook.
- Assign the firm's number to this application.
- Keep Scott's generated telephony credential under the existing credential connection.

No Telnyx API secret or SIP password is exposed to the browser.

## Application Components

### Inbound TeXML endpoint

Add an unauthenticated Telnyx endpoint that:

- accepts the Telnyx request;
- validates that inbound routing configuration is complete;
- returns XML with the agent SIP destination first and fallback number second;
- XML-escapes every interpolated value;
- constrains the timeout to Telnyx's supported range;
- returns a safe hangup response when required configuration is absent.

The endpoint will not trust request-supplied destinations.

### Webhook verification

Replace the incompatible SDK unwrap call with verification of the exact raw request body using:

- `telnyx-signature-ed25519`;
- `telnyx-timestamp`;
- the account public key from `TELNYX_PUBLIC_KEY`;
- a five-minute timestamp tolerance.

Only verified payloads proceed to idempotent event storage and call-log normalization.

### Existing softphone

No UI redesign is required. The existing Telnyx notification handler already recognizes an inbound ringing call, presents Answer/Decline controls, and uses the Telnyx call object to answer it. The softphone remains mounted while its panel is closed, preserving WebRTC registration.

## Failure Handling

- Scott offline: the SIP attempt ends and Telnyx advances to the fallback number.
- Scott declines: Telnyx advances to the fallback number.
- Scott does not answer: the 25-second timeout advances to the fallback number.
- Fallback does not answer: the call ends normally.
- Missing routing configuration: the TeXML endpoint returns a valid hangup document and logs a configuration error without leaking secrets.
- Duplicate Telnyx events: the existing provider-event uniqueness check returns success.
- Invalid or replayed callbacks: return HTTP 401 and do not write call data.

## Testing

Focused automated tests will cover:

- a valid Telnyx Ed25519 signature is accepted;
- a changed payload, invalid signature, missing header, or stale timestamp is rejected;
- the TeXML document dials Scott before the fallback number;
- the TeXML document uses a 25-second timeout and `answerOnBridge`;
- XML-special characters cannot corrupt the response;
- missing configuration returns a safe hangup document;
- existing Telnyx call-event normalization and softphone tests remain green.

Production verification will confirm:

- the token endpoint remains HTTP 200;
- Telnyx webhook deliveries return HTTP 200 instead of 401;
- an inbound test call rings Scott's browser;
- declining the call forwards it to `+13392381012`;
- allowing the call to ring for 25 seconds forwards it to `+13392381012`.

## Scope

This change does not modify drafting code, add staff routing, add queues, or introduce another telephony provider. Multi-agent presence and simultaneous ringing remain out of scope because Scott is the only staff user.
