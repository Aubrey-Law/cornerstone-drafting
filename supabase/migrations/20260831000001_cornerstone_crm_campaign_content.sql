-- Add campaign content fields to support simple plain-text / HTML campaign sends.

alter table public.cornerstone_crm_campaigns
  add column if not exists subject text,
  add column if not exists body_text text,
  add column if not exists body_html text;

update public.cornerstone_crm_campaigns
set
  subject = coalesce(subject, ''),
  body_text = coalesce(body_text, ''),
  body_html = coalesce(body_html, '')
where subject is null or body_text is null or body_html is null;
