-- Standardize contact name structure: leads should offer first/middle/last
-- consistently with contacts and client_intake. Middle stays optional (nullable)
-- so records are never blocked for people without a middle name.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS middle_name text,
  ADD COLUMN IF NOT EXISTS spouse_middle_name text;
