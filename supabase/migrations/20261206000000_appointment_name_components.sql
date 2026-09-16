-- Historical and imported display names remain intact; never guess their components.
alter table public.appointments
  add column attendee_first_name text,
  add column attendee_last_name text,
  add column second_attendee_first_name text,
  add column second_attendee_last_name text;

comment on column public.appointments.attendee_first_name is
  'Nullable for historical compatibility. New native bookings require validated name components at the application boundary.';
comment on column public.appointments.attendee_last_name is
  'Nullable for historical compatibility. New native bookings require validated name components at the application boundary.';
comment on column public.appointments.second_attendee_first_name is
  'Nullable for historical compatibility or no second attendee. New second attendees require paired name components at the application boundary.';
comment on column public.appointments.second_attendee_last_name is
  'Nullable for historical compatibility or no second attendee. New second attendees require paired name components at the application boundary.';
