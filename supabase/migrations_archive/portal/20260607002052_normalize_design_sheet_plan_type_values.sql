update public.design_sheets
set plan_type = 'pour_over'
where plan_type in (
  'individual_trust',
  'joint_trust',
  'married_simple',
  'married_disclaimer',
  'married_clayton',
  'revocable_trust',
  'Individual Trust',
  'Joint Trust',
  'Joint Trust - LP',
  'Joint Trust — LP',
  'Married - Simple',
  'Married - Disclaimer',
  'Married - Clayton',
  'Married — Simple',
  'Married — Disclaimer',
  'Married — Clayton'
);

update public.design_sheets
set plan_type = 'outright_will'
where plan_type in (
  'will_based_plan',
  'Will-Based Plan'
);
