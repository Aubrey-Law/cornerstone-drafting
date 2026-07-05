-- Remove numeric Lawmatics values that were accidentally appended to matter names.
-- Example: "Cory Siansky 570648" -> "Cory Siansky"
update public.matters
set name = btrim(regexp_replace(name, '\s+\d{5,}$', ''))
where name ~ '\s+\d{5,}$';
