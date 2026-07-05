-- VA system: task management, document versioning, comments, and audit logging

-- Enum types
create type va_task_status as enum ('pending', 'in_progress', 'completed');
create type va_task_priority as enum ('low', 'medium', 'high', 'urgent');
create type va_task_type as enum ('administrative', 'client_related');
create type va_audit_action as enum (
  'task_viewed',
  'task_created',
  'task_updated',
  'task_completed',
  'document_uploaded',
  'document_downloaded',
  'comment_added',
  'status_changed'
);

-- tasks table
create table if not exists va_tasks (
  id            uuid primary key default gen_random_uuid(),
  assigned_to   uuid not null references auth.users(id),
  matter_id     text,                              -- nullable: can be admin tasks not tied to a matter
  task_type     va_task_type not null default 'administrative',
  priority      va_task_priority not null default 'medium',
  status        va_task_status not null default 'pending',
  title         text not null,
  description   text,
  due_date      timestamptz,
  created_by    uuid not null references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_va_tasks_assigned_to on va_tasks(assigned_to);
create index if not exists idx_va_tasks_matter_id on va_tasks(matter_id);
create index if not exists idx_va_tasks_status on va_tasks(status);
create index if not exists idx_va_tasks_priority on va_tasks(priority);
create index if not exists idx_va_tasks_due_date on va_tasks(due_date);

-- task_comments table
create table if not exists va_task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references va_tasks(id) on delete cascade,
  user_id    uuid not null references auth.users(id),
  comment    text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_va_task_comments_task on va_task_comments(task_id);
create index if not exists idx_va_task_comments_user on va_task_comments(user_id);

-- task_documents table: versioned document storage with R2 integration
create table if not exists va_task_documents (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null references va_tasks(id) on delete cascade,
  file_name      text not null,
  file_size      bigint not null,
  content_type   text not null default 'application/octet-stream',
  r2_key         text not null,                   -- e.g., /va-uploads/{task_id}/v{version}-{filename}
  version_number integer not null,                -- incremented for each upload
  is_current     boolean not null default true,
  uploaded_by    uuid not null references auth.users(id),
  uploaded_at    timestamptz not null default now()
);

create index if not exists idx_va_task_documents_task on va_task_documents(task_id);
create index if not exists idx_va_task_documents_current on va_task_documents(task_id, is_current);

-- va_audit_log table: comprehensive audit trail
create table if not exists va_audit_log (
  id          uuid primary key default gen_random_uuid(),
  va_user_id  uuid not null references auth.users(id),
  action_type va_audit_action not null,
  task_id     uuid references va_tasks(id),
  document_id uuid references va_task_documents(id),
  details     jsonb,                              -- arbitrary metadata (e.g., status change from X to Y)
  created_at  timestamptz not null default now()
);

create index if not exists idx_va_audit_log_va_user on va_audit_log(va_user_id);
create index if not exists idx_va_audit_log_task on va_audit_log(task_id);
create index if not exists idx_va_audit_log_created_at on va_audit_log(created_at);

-- RLS: Enable row level security
alter table va_tasks enable row level security;
alter table va_task_comments enable row level security;
alter table va_task_documents enable row level security;
alter table va_audit_log enable row level security;

-- RLS: Admins (scott@aubreylegal.com) can do everything on all tables
create policy "admin_all_tasks" on va_tasks
  using ((select email from auth.users where id = auth.uid()) = 'scott@aubreylegal.com');

create policy "admin_all_comments" on va_task_comments
  using ((select email from auth.users where id = auth.uid()) = 'scott@aubreylegal.com');

create policy "admin_all_documents" on va_task_documents
  using ((select email from auth.users where id = auth.uid()) = 'scott@aubreylegal.com');

create policy "admin_all_audit" on va_audit_log
  using ((select email from auth.users where id = auth.uid()) = 'scott@aubreylegal.com');

-- RLS: VAs can only see tasks assigned to them
create policy "va_read_assigned_tasks" on va_tasks
  for select
  using (
    assigned_to = auth.uid()
  );

create policy "va_update_own_tasks" on va_tasks
  for update
  using (
    assigned_to = auth.uid()
  )
  with check (
    assigned_to = auth.uid()
  );

-- RLS: VAs can see comments on their assigned tasks
create policy "va_read_assigned_task_comments" on va_task_comments
  for select
  using (
    task_id in (
      select id from va_tasks where assigned_to = auth.uid()
    )
  );

-- RLS: VAs can create comments on their assigned tasks
create policy "va_create_comments_on_assigned_tasks" on va_task_comments
  for insert
  with check (
    user_id = auth.uid()
    and task_id in (
      select id from va_tasks where assigned_to = auth.uid()
    )
  );

-- RLS: VAs can see documents for their assigned tasks
create policy "va_read_assigned_task_documents" on va_task_documents
  for select
  using (
    task_id in (
      select id from va_tasks where assigned_to = auth.uid()
    )
  );

-- RLS: VAs can upload documents to their assigned tasks
create policy "va_upload_documents_to_assigned_tasks" on va_task_documents
  for insert
  with check (
    uploaded_by = auth.uid()
    and task_id in (
      select id from va_tasks where assigned_to = auth.uid()
    )
  );

-- RLS: VAs can read their own audit log
create policy "va_read_own_audit_log" on va_audit_log
  for select
  using (
    va_user_id = auth.uid()
  );
