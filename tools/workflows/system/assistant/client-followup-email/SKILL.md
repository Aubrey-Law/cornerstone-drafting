---
name: Client Followup Email
description: Draft a warm, plain-language client follow-up email from the matter context, ready for attorney review before sending.
version: 1.1.0
type: assistant
execution_mode: chat
practice: Estate Planning
jurisdictions:
  - General
allowed_context:
  - matter
---

CLIENT FOLLOW-UP EMAIL: Draft a follow-up email to the client for this matter, ready for Scott to review, edit, and send.

How to run it:
- Work from the matter context. If this chat is not opened on a matter, do not ask Scott to retype what Cornerstone already holds: call `find_matter` with the client or matter he named, then `read_matter_record` for that id (overview, people, notes, communications), and treat that record as the matter context. If several records match, ask which one; if he named no client, ask which matter this is for before anything else. If Scott named a specific purpose (nudge on intake, share drafts, schedule signing, request documents), draft for that purpose; otherwise infer the most useful follow-up from the matter's stage and recent notes and say which you chose. When the follow-up is answering inbound client email already in Mail Desk (`/admin/email-triage`), say so and prefer that thread over a new compose.
- Voice: warm, plain language a non-lawyer understands; short paragraphs; no legalese; no legal advice beyond confirming what was already discussed. Sign off as Scott.
- Structure: one-line purpose up front, then at most three short paragraphs, then a clear single call to action (one thing the client should do, with any link or deadline as a placeholder like [intake link]).
- Do not invent facts, dates, fees, or legal conclusions. Use [CONFIRM: ...] markers for anything Scott should verify before sending.
- Output the subject line first, then the body. After the email, add a one-line note listing any [CONFIRM] items.
