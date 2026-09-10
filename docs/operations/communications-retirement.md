# Communications retirement — 2026-09-10

The owner approved external calling/texting, retention of secure client-portal messaging, and retirement of automated SMS. This is a code release, not a provider-account cutover.

| Path or capability | Disposition |
| --- | --- |
| Admin rail phone/text panes; browser softphone/provider/directory hook | Removed, including Twilio Voice and Telnyx WebRTC browser dependencies |
| `/api/token` | Authenticated 410; issues no browser credentials |
| Lead, matter and contact `send-sms` APIs | Authenticated 410; no delivery |
| Scheduling-link SMS | 410; email and portal channels retained |
| `lib/appointments/reminders.ts` | Email reminder path retained; SMS path removed; legacy SMS setting ignored |
| `lib/retell/notify.ts` | Email alerts retained; SMS alerts removed |
| `lib/sms/provider.ts` | Closed compatibility boundary; always returns disabled |
| Twilio/Telnyx outbound SMS adapters | Deleted after confirming no active consumers |
| Twilio SMS / Telnyx messaging webhooks | Retained signature checks, delivery/history and consent recording; removed application opt-out confirmation sends |
| `/admin/inbox` | Redirects to Today; Inbox client, list/thread APIs and query module removed |
| Secure portal replies | Matter Portal messages tab; separate unread summary; only displayed client message IDs marked read |
| Historical SMS and email | Stored rows/migrations retained; record history remains accessible to authorized users |
| Inbound voice/Retell callbacks and provider server SDKs | Retained for existing external routing and callbacks; no provider configuration changed |

## Configuration and rollout

Outbound application SMS is retired even if old credentials or provider selections remain present. `MANUAL_COMMUNICATIONS_ENABLED` defaults to false; `SMS_PROVIDER=none` and `VOICE_PROVIDER=none` are recognized. Unknown provider names fail configuration instead of silently choosing Twilio. Manual endpoints remain retired even if someone sets the old manual flag to true.

Do not delete webhook verification secrets, revoke provider credentials, cancel numbers, or change inbound destinations based solely on this code removal. Those may still protect/process externally routed calls, incoming historical messages, provider-generated opt-out responses, and delivery callbacks. Provider-generated messages are outside the application send paths removed here.

No table, communications row, opt-out record, or number is deleted. No real email, SMS, or portal message was sent during local verification. Rollback must preserve the retirement boundary; reverting UI code must not silently reenable application sending.

Live acceptance remains open: authenticated staff/client portal walkthrough, incoming callback verification, and separate confirmation of external phone routing. Use synthetic accounts for send/reply verification.
