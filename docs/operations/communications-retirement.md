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

## 2026-09-22 — manual staff texting restored (Telnyx only)

The owner reversed part of the retirement above: staff can again text leads, clients and contacts from the app, and read and answer incoming texts in one place. Everything else in the table stays retired — the softphone, the rail Text pane, automated and reminder SMS, Retell SMS alerts, scheduling-link SMS, and Twilio SMS.

| Capability | Now |
| --- | --- |
| `/admin/texts` | New Texts page: one conversation per outside phone number, including numbers that match no record. Unknown senders can be linked to a record or turned into a lead. |
| Lead, matter and contact `send-sms` APIs | Working again; Telnyx only |
| Record pages | Text composer back on the communications card and matter Messages tab, plus an "Open in Texts" link |
| `/admin/inbox` | Redirects to `/admin/texts` |
| Opt-outs | New `sms_opt_outs` table, fed by inbound STOP/START. Every send checks it and refuses opted-out numbers (409). If the list can't be read, the send is refused (503) rather than risk texting someone who said STOP. |
| Sidebar | "Texts" item with a count of conversations holding unread texts |

The retirement's rule that sending must never come back silently still holds. Texting needs **both** `SMS_PROVIDER=telnyx` and `MANUAL_COMMUNICATIONS_ENABLED=true`, plus the Telnyx credentials. `SMS_PROVIDER` now defaults to `none`, and `twilio` never sends. Without those settings every send route answers 503 and the Texts page is read-only.

Cutover: set the variables above in production, then point the Telnyx Messaging Profile's inbound webhook at `https://<host>/api/webhooks/telnyx/messaging` and stop routing that number's texts to the outside service. Telnyx's messaging profile still sends the carrier STOP confirmation; the app sends none.
