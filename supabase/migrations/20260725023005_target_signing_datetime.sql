alter table public.matter_details
  alter column scheduled_signing_date type timestamptz
  using (
    scheduled_signing_date::timestamp
    at time zone 'America/New_York'
  );
