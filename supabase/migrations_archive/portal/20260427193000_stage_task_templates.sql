/*
  # Stage Task Templates

  Practice-area-aware task templates used to populate matter task lists.
*/

create table if not exists stage_task_templates (
  id             uuid primary key default gen_random_uuid(),
  practice_area  text not null check (practice_area in ('EP', 'EP-LP', 'Probate')),
  stage          text not null,
  title          text not null,
  priority       text not null check (priority in ('low', 'medium', 'high', 'urgent')),
  default_status text not null default 'todo' check (default_status in ('todo', 'complete')),
  sort_order     integer not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists stage_task_template_subtasks (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references stage_task_templates(id) on delete cascade,
  title       text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists stage_task_templates_practice_stage_idx
  on stage_task_templates(practice_area, stage, sort_order);

create index if not exists stage_task_template_subtasks_template_idx
  on stage_task_template_subtasks(template_id, sort_order);

create or replace function set_stage_task_templates_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists stage_task_templates_set_updated_at on stage_task_templates;
create trigger stage_task_templates_set_updated_at
before update on stage_task_templates
for each row
execute function set_stage_task_templates_updated_at();

drop trigger if exists stage_task_template_subtasks_set_updated_at on stage_task_template_subtasks;
create trigger stage_task_template_subtasks_set_updated_at
before update on stage_task_template_subtasks
for each row
execute function set_stage_task_templates_updated_at();

alter table stage_task_templates enable row level security;
alter table stage_task_template_subtasks enable row level security;

drop policy if exists "attorneys_manage_stage_task_templates" on stage_task_templates;
create policy "attorneys_manage_stage_task_templates"
  on stage_task_templates
  for all
  using ((auth.jwt() ->> 'email') = 'scott@aubreylegal.com')
  with check ((auth.jwt() ->> 'email') = 'scott@aubreylegal.com');

drop policy if exists "attorneys_manage_stage_task_template_subtasks" on stage_task_template_subtasks;
create policy "attorneys_manage_stage_task_template_subtasks"
  on stage_task_template_subtasks
  for all
  using ((auth.jwt() ->> 'email') = 'scott@aubreylegal.com')
  with check ((auth.jwt() ->> 'email') = 'scott@aubreylegal.com');

do $$
declare
  template_id uuid;
begin
  if not exists (select 1 from stage_task_templates) then
    insert into stage_task_templates (practice_area, stage, title, priority, default_status, sort_order)
    values
      ('EP', 'intake', 'Intake received', 'medium', 'complete', 10),
      ('EP', 'design', 'Design meeting', 'high', 'todo', 20),
      ('EP', 'drafting', 'Draft Will', 'high', 'todo', 30),
      ('EP', 'drafting', 'Draft Healthcare Proxy', 'medium', 'todo', 40),
      ('EP', 'drafting', 'Draft Durable Power of Attorney', 'medium', 'todo', 50),
      ('EP', 'drafting', 'Draft Trust', 'high', 'todo', 60),
      ('EP', 'client_review', 'Client review meeting', 'medium', 'todo', 70),
      ('EP', 'signing_scheduled', 'Signing appointment', 'high', 'todo', 80);

    select id into template_id from stage_task_templates where practice_area = 'EP' and title = 'Design meeting';
    insert into stage_task_template_subtasks (template_id, title, sort_order)
    values
      (template_id, 'Confirm date and time', 10),
      (template_id, 'Send calendar invite', 20),
      (template_id, 'Prepare agenda', 30);

    select id into template_id from stage_task_templates where practice_area = 'EP' and title = 'Draft Will';
    insert into stage_task_template_subtasks (template_id, title, sort_order)
    values
      (template_id, 'Draft executor clause', 10),
      (template_id, 'Draft guardian clause', 20),
      (template_id, 'Draft residuary clause', 30),
      (template_id, 'Draft specific bequests', 40);

    select id into template_id from stage_task_templates where practice_area = 'EP' and title = 'Draft Healthcare Proxy';
    insert into stage_task_template_subtasks (template_id, title, sort_order)
    values
      (template_id, 'Confirm agent designation', 10),
      (template_id, 'Draft care instructions', 20);

    select id into template_id from stage_task_templates where practice_area = 'EP' and title = 'Draft Durable Power of Attorney';
    insert into stage_task_template_subtasks (template_id, title, sort_order)
    values
      (template_id, 'Confirm attorney-in-fact', 10),
      (template_id, 'Draft financial powers', 20);

    select id into template_id from stage_task_templates where practice_area = 'EP' and title = 'Draft Trust';
    insert into stage_task_template_subtasks (template_id, title, sort_order)
    values
      (template_id, 'Draft trust terms', 10),
      (template_id, 'Draft trustee provisions', 20),
      (template_id, 'Draft distribution provisions', 30),
      (template_id, 'Draft pour-over provisions', 40);

    select id into template_id from stage_task_templates where practice_area = 'EP' and title = 'Client review meeting';
    insert into stage_task_template_subtasks (template_id, title, sort_order)
    values
      (template_id, 'Prepare redline', 10),
      (template_id, 'Send documents to client', 20),
      (template_id, 'Schedule review call', 30);

    select id into template_id from stage_task_templates where practice_area = 'EP' and title = 'Signing appointment';
    insert into stage_task_template_subtasks (template_id, title, sort_order)
    values
      (template_id, 'Confirm witnesses', 10),
      (template_id, 'Prepare signing package', 20),
      (template_id, 'Confirm notary', 30);

    insert into stage_task_templates (practice_area, stage, title, priority, default_status, sort_order)
    select 'EP-LP', stage, title, priority, default_status, sort_order
    from stage_task_templates
    where practice_area = 'EP';

    insert into stage_task_template_subtasks (template_id, title, sort_order)
    select clone.id, subtasks.title, subtasks.sort_order
    from stage_task_templates original
    join stage_task_templates clone
      on clone.practice_area = 'EP-LP'
     and clone.stage = original.stage
     and clone.title = original.title
    join stage_task_template_subtasks subtasks
      on subtasks.template_id = original.id
    where original.practice_area = 'EP';

    insert into stage_task_templates (practice_area, stage, title, priority, default_status, sort_order)
    values
      ('Probate', 'intake', 'Open probate matter and confirm appointment', 'high', 'todo', 10),
      ('Probate', 'intake_review', 'Collect original will and death certificate', 'high', 'todo', 20),
      ('Probate', 'design', 'Prepare probate filing strategy', 'medium', 'todo', 30),
      ('Probate', 'drafting', 'File petition with probate court', 'urgent', 'todo', 40),
      ('Probate', 'drafting', 'Publish notice to creditors', 'high', 'todo', 50),
      ('Probate', 'client_review', 'Review Letters and bond requirements with client', 'medium', 'todo', 60),
      ('Probate', 'revision', 'File inventory and accountings', 'high', 'todo', 70),
      ('Probate', 'post_execution', 'Distribute assets and close estate', 'high', 'todo', 80);

    select id into template_id from stage_task_templates where practice_area = 'Probate' and title = 'Open probate matter and confirm appointment';
    insert into stage_task_template_subtasks (template_id, title, sort_order)
    values
      (template_id, 'Confirm petitioner contact information', 10),
      (template_id, 'Check venue and county', 20);

    select id into template_id from stage_task_templates where practice_area = 'Probate' and title = 'Collect original will and death certificate';
    insert into stage_task_template_subtasks (template_id, title, sort_order)
    values
      (template_id, 'Request certified death certificates', 10),
      (template_id, 'Confirm original estate planning documents', 20);

    select id into template_id from stage_task_templates where practice_area = 'Probate' and title = 'Prepare probate filing strategy';
    insert into stage_task_template_subtasks (template_id, title, sort_order)
    values
      (template_id, 'Determine informal vs formal probate', 10),
      (template_id, 'Identify interested persons', 20);

    select id into template_id from stage_task_templates where practice_area = 'Probate' and title = 'File petition with probate court';
    insert into stage_task_template_subtasks (template_id, title, sort_order)
    values
      (template_id, 'Draft petition and citations', 10),
      (template_id, 'Assemble filing exhibits', 20);

    select id into template_id from stage_task_templates where practice_area = 'Probate' and title = 'Publish notice to creditors';
    insert into stage_task_template_subtasks (template_id, title, sort_order)
    values
      (template_id, 'Coordinate publication with approved paper', 10),
      (template_id, 'Calendar claim deadline', 20);

    select id into template_id from stage_task_templates where practice_area = 'Probate' and title = 'Review Letters and bond requirements with client';
    insert into stage_task_template_subtasks (template_id, title, sort_order)
    values
      (template_id, 'Explain fiduciary duties', 10),
      (template_id, 'Confirm bond waiver or bond application', 20);

    select id into template_id from stage_task_templates where practice_area = 'Probate' and title = 'File inventory and accountings';
    insert into stage_task_template_subtasks (template_id, title, sort_order)
    values
      (template_id, 'Inventory probate assets', 10),
      (template_id, 'Draft interim accounting', 20);

    select id into template_id from stage_task_templates where practice_area = 'Probate' and title = 'Distribute assets and close estate';
    insert into stage_task_template_subtasks (template_id, title, sort_order)
    values
      (template_id, 'Prepare receipts and releases', 10),
      (template_id, 'File closing statement', 20);
  end if;
end
$$;
