-- Add a truthful three-state fee status while retaining compatibility with
-- legacy code that still reads or writes matter_details.fee_collected.

ALTER TABLE public.matter_details
  ADD COLUMN IF NOT EXISTS fee_payment_status text;

UPDATE public.matter_details
SET fee_payment_status = CASE
  WHEN fee_collected IS TRUE THEN 'paid_in_full'
  ELSE 'unpaid'
END
WHERE fee_payment_status IS NULL;

ALTER TABLE public.matter_details
  ALTER COLUMN fee_payment_status SET DEFAULT 'unpaid',
  ALTER COLUMN fee_payment_status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'matter_details_fee_payment_status_check'
      AND conrelid = 'public.matter_details'::regclass
  ) THEN
    ALTER TABLE public.matter_details
      ADD CONSTRAINT matter_details_fee_payment_status_check
      CHECK (fee_payment_status IN ('unpaid', 'deposit', 'paid_in_full'));
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.sync_matter_fee_payment_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.fee_collected IS TRUE AND NEW.fee_payment_status = 'unpaid' THEN
      NEW.fee_payment_status := 'paid_in_full';
    ELSE
      NEW.fee_collected := NEW.fee_payment_status = 'paid_in_full';
    END IF;
  ELSIF NEW.fee_payment_status IS DISTINCT FROM OLD.fee_payment_status THEN
    NEW.fee_collected := NEW.fee_payment_status = 'paid_in_full';
  ELSIF NEW.fee_collected IS DISTINCT FROM OLD.fee_collected THEN
    NEW.fee_payment_status := CASE
      WHEN NEW.fee_collected IS TRUE THEN 'paid_in_full'
      ELSE 'unpaid'
    END;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_sync_matter_fee_payment_status ON public.matter_details;
CREATE TRIGGER trg_sync_matter_fee_payment_status
  BEFORE INSERT OR UPDATE OF fee_payment_status, fee_collected
  ON public.matter_details
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_matter_fee_payment_status();
