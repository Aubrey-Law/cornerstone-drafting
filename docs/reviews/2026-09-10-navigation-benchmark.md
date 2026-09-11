# Live navigation baseline — 2026-09-10

After the owner signed in, 21 repeated read-only cycles were observed against production. Production and main matched `03e284d0` at execution start. The remediation branch has not been deployed.

## Method and limitations

Local macOS host, Codex in-app browser, normal network, no artificial throttling, one authenticated staff session. Warm sequence: Tasks → CRM → Leads (Opportunities) → Matters overview → Matters list → first visible matter detail → Billing → Today.

These are **tool-observed click-to-visible-control proxies**, including RPC/polling overhead. Concurrent local development can affect timings. They are not raw browser TTFB or controlled device measurements. Readiness targets: New task, New lead, New matter, matter Overview tab, Log payment, and Today “Do this next”; intermediary overview pages used their heading. Later samples retried short tool readiness waits. One detail observation was censored; its eventual DOM loaded but no duration is invented.

| Route | Valid samples | Unmeasured | p50 | p95 | Maximum |
| --- | ---: | ---: | ---: | ---: | ---: |
| Tasks | 21 | 0 | 1.61 s | 3.09 s | 3.10 s |
| CRM | 21 | 0 | 0.89 s | 3.07 s | 3.08 s |
| Leads | 21 | 0 | 0.95 s | 1.76 s | 2.65 s |
| Matters overview | 21 | 0 | 1.15 s | 3.09 s | 3.10 s |
| Matters | 21 | 0 | 1.04 s | 1.48 s | 1.92 s |
| Matter detail | 20 | 1 | 1.72 s | 2.23 s | 2.79 s |
| Billing | 21 | 0 | 1.09 s | 3.23 s | 3.23 s |
| Today | 21 | 0 | 2.69 s | 5.51 s | 8.95 s |

Nearest-rank quantiles, excluding the censored observation. Separate initial visits: Tasks 1.81 s; Leads 0.81 s; Matters overview 3.27 s; Matters list 0.72 s; matter detail 1.32 s; Billing 3.09 s; Today 3.07 s. These were first visits in this session, not proven cold caches.

[Raw repeated observations](2026-09-10-navigation-baseline.json) contain route labels and timing only; no client names, IDs, messages, credentials, or raw URLs.

## Prepared instrumentation and remaining acceptance

Local User Timing starts on internal clicks and finishes after the primary ready boundary mounts and paints. Optional calendar/financial/planning sections are excluded. Entries contain fixed route labels and bounded local history; no network sends or additional telemetry SDK. Loading/error fallbacks do not emit successful readiness. Query-only filter transitions and lead detail are not covered yet.

The observations reproduce intermittent multi-second waits, especially Today, but do not prove improvement. Apply additive migrations, deploy the reviewed release, then repeat the same sequence and capture native browser timings and existing sampled server spans. Pending-feedback latency, bytes/request counts, TTFB, server phases, scripting, lead detail, and after-deployment comparisons remain unmeasured. The ≤2-second warm p95 and ≤200-ms pending targets remain open.

## Browser bundle report

The full analyzer exhausted 4 GB and 8 GB Node heaps on this 16 GB host. An opt-in `ANALYZE_TARGET=client` configuration omits server analyzer plugins while preserving ordinary builds and full-analysis behavior. Its behavior was checked directly (zero server analyzer plugins, one browser plugin), and it generated `.next/analyze/client.html` with a 4 GB heap:

```sh
ANALYZE_TARGET=client NODE_OPTIONS=--max-old-space-size=4096 npm run build:analyze
```

The verification run used synthetic build configuration. The browser report contains **455 chunks, 5,986,377 parsed bytes and 1,888,049 gzip bytes across the entire app**. These are aggregate emitted chunks, not a single page's download size; routes share/load subsets. Neither `@twilio/voice-sdk` nor `@telnyx/webrtc` appears in the report. There is no equivalent pre-change bundle report, so no byte-savings figure is claimed. Local report copy: `/tmp/cornerstone-remediation-artifacts/client-bundle.html` (not committed).
