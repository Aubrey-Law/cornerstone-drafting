// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const migrations = resolve(process.cwd(), 'supabase/migrations')
const files = readdirSync(migrations).filter((name) => name.endsWith('_intake_form_builder_foundation.sql'))
const sql = files.length === 1 ? readFileSync(resolve(migrations, files[0]), 'utf8') : ''
const auditFiles = readdirSync(migrations).filter((name) => name.endsWith('_intake_form_builder_audit.sql'))
const auditSql = auditFiles.length === 1 ? readFileSync(resolve(migrations, auditFiles[0]), 'utf8') : ''
const lifecycleFunctions = [
  'create_intake_form_template', 'save_intake_form_draft', 'create_next_intake_form_draft',
  'publish_intake_form_draft', 'retire_intake_form_version', 'archive_intake_form_template',
  'discard_intake_form_draft',
]

describe('intake form database foundation', () => {
  it('defines the additive version model and uniqueness constraints', () => {
    expect(files).toHaveLength(1)
    expect(sql).toContain('CREATE TABLE public.intake_form_templates')
    expect(sql).toContain('CREATE TABLE public.intake_form_versions')
    expect(sql).toMatch(/ALTER TABLE public\.client_intake[\s\S]*ADD COLUMN[\s\S]*form_version_id uuid/i)
    expect(sql).toContain("status IN ('draft', 'published', 'retired')")
    expect(sql).toMatch(/CREATE UNIQUE INDEX[\s\S]*WHERE status = 'draft'/i)
    expect(sql).toContain('UNIQUE (template_id, version)')
  })

  it('denies browser access and retains the immutable definition guard', () => {
    expect(sql.match(/ENABLE ROW LEVEL SECURITY/g)).toHaveLength(2)
    for (const table of ['intake_form_templates', 'intake_form_versions']) {
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON public\\.${table} FROM PUBLIC, anon, authenticated`, 'i'))
      expect(sql).toMatch(new RegExp(`GRANT SELECT, INSERT, UPDATE, DELETE ON public\\.${table} TO service_role`, 'i'))
    }
    expect(sql).toContain("OLD.status IN ('published', 'retired')")
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON public\.intake_form_versions/i)
  })

  it.each(lifecycleFunctions)('%s has a controlled admin-only execution boundary', (name) => {
    const body = sql.match(new RegExp(`CREATE FUNCTION public\\.${name}\\([\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`, 'i'))
    expect(body, `${name} exists`).not.toBeNull()
    expect(body![0]).toContain('SECURITY DEFINER')
    expect(body![0]).toContain("SET search_path = ''")
    expect(body![1]).toMatch(/p_actor_id IS NULL[\s\S]*public\.users[\s\S]*id = p_actor_id AND role = 'admin'/i)
    expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^;]*FROM PUBLIC, anon, authenticated`, 'i'))
    expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^;]*TO service_role`, 'i'))
    expect(sql).not.toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^;]*TO (?:PUBLIC|anon|authenticated)`, 'i'))
  })
})

describe('intake form lifecycle audit migration', () => {
  it('retains durable event identity and restricts audit access', () => {
    expect(auditFiles).toHaveLength(1)
    expect(auditSql).toContain('CREATE TABLE public.intake_form_audit_events')
    expect(auditSql).toContain("action IN ('create', 'save', 'create_next_draft', 'publish', 'retire', 'archive', 'restore', 'duplicate', 'discard')")
    expect(auditSql).toMatch(/version_id uuid REFERENCES public\.intake_form_versions\(id\) ON DELETE SET NULL/i)
    expect(auditSql).toMatch(/metadata jsonb NOT NULL DEFAULT '\{\}'::jsonb/i)
    expect(auditSql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(auditSql).toMatch(/REVOKE ALL ON public\.intake_form_audit_events FROM PUBLIC, anon, authenticated/i)
    expect(auditSql).toMatch(/REVOKE ALL ON public\.intake_form_audit_events FROM service_role/i)
    expect(auditSql).toMatch(/GRANT SELECT, INSERT ON public\.intake_form_audit_events TO service_role/i)
  })

  it.each([...lifecycleFunctions, 'duplicate_intake_form_template'])('%s retains controlled execution and writes an event', (name) => {
    const body = auditSql.match(new RegExp(`CREATE(?: OR REPLACE)? FUNCTION public\\.${name}\\([\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`, 'i'))
    expect(body, `${name} exists`).not.toBeNull()
    expect(body![0]).toContain('SECURITY DEFINER')
    expect(body![0]).toContain("SET search_path = ''")
    expect(body![1]).toMatch(/p_actor_id IS NULL[\s\S]*public\.users[\s\S]*id = p_actor_id AND role = 'admin'/i)
    expect(body![1].match(/INSERT INTO public\.intake_form_audit_events/g)).toHaveLength(1)
    expect(auditSql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^;]*FROM PUBLIC, anon, authenticated`, 'i'))
    expect(auditSql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^;]*TO service_role`, 'i'))
  })
})

// Opt-in integration checks run only against an explicitly supplied loopback DB.
// VITEST_INTAKE_FORM_TEST_DB_URL=postgresql://postgres:postgres@127.0.0.1:55422/postgres npm test -- tests/intake-form-builder-schema.test.ts
// VITEST_ runner settings survive the unit suite's application-env isolation.
const localDatabaseUrl = process.env.VITEST_INTAKE_FORM_TEST_DB_URL
const admin = '10000000-0000-4000-8000-000000000001'
const attorney = '10000000-0000-4000-8000-000000000002'
const hash = 'a'.repeat(64)
const fixture = `
  BEGIN;
  INSERT INTO auth.users (id, email) VALUES
    ('${admin}', 'form-schema-admin@example.test'),
    ('${attorney}', 'form-schema-attorney@example.test') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.users (id, role) VALUES ('${admin}', 'admin'), ('${attorney}', 'attorney')
    ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  CREATE FUNCTION pg_temp.expect_failure(statement text, message_pattern text) RETURNS void
    LANGUAGE plpgsql AS $test$
    BEGIN
      BEGIN
        EXECUTE statement;
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE message_pattern THEN RAISE; END IF;
        RETURN;
      END;
      RAISE EXCEPTION 'Expected failure for: %', statement;
    END;
    $test$;
`

function checkDatabase(statement: string) {
  const url = new URL(localDatabaseUrl!)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Database guard tests require a loopback database')
  }
  const result = spawnSync('psql', ['-X', '--no-password', '--set', 'ON_ERROR_STOP=1', localDatabaseUrl!], {
    input: `${fixture}\n${statement}\nROLLBACK;`, encoding: 'utf8', timeout: 30_000,
  })
  expect(result.error).toBeUndefined()
  expect(result.status, result.stderr || result.stdout).toBe(0)
}

describe.skipIf(!localDatabaseUrl)('intake form database guards (local PostgreSQL)', () => {
  it('records exactly one event per lifecycle call and retains discarded version identity', () => {
    checkDatabase(`
      CREATE FUNCTION pg_temp.expect_event(t uuid, a text, n integer, v uuid, total integer) RETURNS void
      LANGUAGE plpgsql AS $test$
      BEGIN
        IF (SELECT count(*) FROM public.intake_form_audit_events WHERE template_id = t) <> total
          OR (SELECT count(*) FROM public.intake_form_audit_events
            WHERE template_id = t AND action = a AND version_number IS NOT DISTINCT FROM n
              AND version_id IS NOT DISTINCT FROM v AND actor_id = '${admin}'
              AND occurred_at IS NOT NULL AND metadata = '{}') <> 1 THEN
          RAISE EXCEPTION 'Missing or duplicate % event', a;
        END IF;
      END;
      $test$;
      SET LOCAL ROLE service_role;
      DO $test$
      DECLARE r jsonb; t uuid; v uuid; next_v uuid;
      BEGIN
        r := public.create_intake_form_template('${admin}', 'audit_lifecycle', 'Audit lifecycle', NULL, '{}', '${hash}');
        t := (r->>'template_id')::uuid; v := (r->>'id')::uuid;
        PERFORM pg_temp.expect_event(t, 'create', 1, v, 1);
        PERFORM pg_temp.expect_failure(
          format('SELECT public.create_intake_form_template(%L,%L,%L,NULL,%L,%L)', '${admin}', 'audit_lifecycle', 'Duplicate', '{}', '${hash}'),
          'duplicate key value violates unique constraint%');
        PERFORM pg_temp.expect_event(t, 'create', 1, v, 1);
        PERFORM public.save_intake_form_draft('${admin}', v, 0, '{"changed":true}', '${hash}');
        PERFORM pg_temp.expect_event(t, 'save', 1, v, 2);
        PERFORM pg_temp.expect_failure(format('SELECT public.save_intake_form_draft(%L,%L,0,%L,%L)', '${admin}', v, '{}', '${hash}'), 'Draft changed; refresh and try again');
        PERFORM pg_temp.expect_event(t, 'save', 1, v, 2);
        PERFORM pg_temp.expect_failure(format('SELECT public.publish_intake_form_draft(%L,%L,0,%L)', '${admin}', v, '${hash}'), 'Draft changed; refresh and try again');
        PERFORM pg_temp.expect_event(t, 'save', 1, v, 2);
        PERFORM public.publish_intake_form_draft('${admin}', v, 1, '${hash}');
        PERFORM pg_temp.expect_event(t, 'publish', 1, v, 3);
        r := public.create_next_intake_form_draft('${admin}', v); next_v := (r->>'id')::uuid;
        PERFORM pg_temp.expect_event(t, 'create_next_draft', 2, next_v, 4);
        PERFORM pg_temp.expect_failure(format('SELECT public.discard_intake_form_draft(%L,%L,1)', '${admin}', next_v), 'Draft changed; refresh and try again');
        PERFORM pg_temp.expect_event(t, 'create_next_draft', 2, next_v, 4);
        PERFORM public.discard_intake_form_draft('${admin}', next_v, 0);
        PERFORM pg_temp.expect_event(t, 'discard', 2, NULL, 5);
        IF EXISTS (SELECT 1 FROM public.intake_form_versions WHERE id = next_v)
          OR EXISTS (SELECT 1 FROM public.intake_form_audit_events WHERE version_id = next_v) THEN
          RAISE EXCEPTION 'Discard did not clear version references';
        END IF;
        PERFORM public.retire_intake_form_version('${admin}', v);
        PERFORM pg_temp.expect_event(t, 'retire', 1, v, 6);
        PERFORM public.archive_intake_form_template('${admin}', t, true);
        PERFORM pg_temp.expect_event(t, 'archive', NULL, NULL, 7);
        PERFORM public.archive_intake_form_template('${admin}', t, false);
        PERFORM pg_temp.expect_event(t, 'restore', NULL, NULL, 8);
      END;
      $test$;
    `)
  })

  it('duplicates draft, published, and retired definitions atomically with only source identifiers in metadata', () => {
    checkDatabase(`
      SET LOCAL ROLE service_role;
      DO $test$
      DECLARE source jsonb; copied jsonb; source_v uuid; source_t uuid; new_v uuid; new_t uuid; state text; count_before bigint;
      BEGIN
        source := public.create_intake_form_template('${admin}', 'audit_source', 'Source', 'Source description', '{"private":"definition"}', '${hash}');
        source_v := (source->>'id')::uuid; source_t := (source->>'template_id')::uuid;
        FOREACH state IN ARRAY ARRAY['draft', 'published', 'retired'] LOOP
          IF state = 'published' THEN PERFORM public.publish_intake_form_draft('${admin}', source_v, 0, '${hash}'); END IF;
          IF state = 'retired' THEN PERFORM public.retire_intake_form_version('${admin}', source_v); END IF;
          copied := public.duplicate_intake_form_template('${admin}', source_v, 'copy_' || state, 'Copy ' || state, 'New description');
          new_v := (copied->>'id')::uuid; new_t := (copied->>'template_id')::uuid;
          IF new_t = source_t OR new_v = source_v OR copied ? 'definition'
            OR copied->>'status' <> 'draft' OR (copied->>'version')::integer <> 1 OR (copied->>'lock_version')::integer <> 0
            OR copied->>'created_by' <> '${admin}' OR copied->>'definition_hash' <> '${hash}'
            OR (SELECT definition FROM public.intake_form_versions WHERE id = new_v) <> '{"private":"definition"}'::jsonb
            OR (SELECT description FROM public.intake_form_templates WHERE id = new_t) <> 'New description' THEN
            RAISE EXCEPTION 'Duplicate copy is incorrect for %', state;
          END IF;
          IF (SELECT count(*) FROM public.intake_form_audit_events WHERE template_id = new_t) <> 1
            OR NOT EXISTS (SELECT 1 FROM public.intake_form_audit_events WHERE template_id = new_t
              AND version_id = new_v AND version_number = 1 AND action = 'duplicate' AND actor_id = '${admin}'
              AND occurred_at IS NOT NULL AND metadata = jsonb_build_object('source_template_id', source_t, 'source_version_id', source_v)) THEN
            RAISE EXCEPTION 'Duplicate audit metadata incorrect';
          END IF;
          SELECT count(*) INTO count_before FROM public.intake_form_audit_events;
          PERFORM pg_temp.expect_failure(format('SELECT public.duplicate_intake_form_template(%L,%L,%L,%L,NULL)', '${admin}', source_v, 'copy_' || state, 'Collision'), 'duplicate key value violates unique constraint%');
          IF (SELECT count(*) FROM public.intake_form_audit_events) <> count_before THEN RAISE EXCEPTION 'Failed duplicate wrote an event'; END IF;
        END LOOP;
        PERFORM pg_temp.expect_failure(format('SELECT public.duplicate_intake_form_template(%L,%L,%L,%L,NULL)', '${admin}', gen_random_uuid(), 'missing_copy', 'Missing'), 'Source version required');
        IF EXISTS (SELECT 1 FROM public.intake_form_templates WHERE key = 'missing_copy') THEN RAISE EXCEPTION 'Missing source created a template'; END IF;
      END;
      $test$;
    `)
  })

  it('rolls back lifecycle mutations when the event insert fails', () => {
    checkDatabase(`
      CREATE FUNCTION pg_temp.reject_audit_event() RETURNS trigger LANGUAGE plpgsql AS $test$
      BEGIN RAISE EXCEPTION 'Audit write rejected'; END;
      $test$;
      DO $test$
      DECLARE r jsonb; v uuid; t uuid; count_before bigint;
      BEGIN
        r := public.create_intake_form_template('${admin}', 'audit_rollback', 'Rollback', NULL, '{}', '${hash}');
        v := (r->>'id')::uuid; t := (r->>'template_id')::uuid;
        CREATE TRIGGER test_reject_audit BEFORE INSERT ON public.intake_form_audit_events
          FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_audit_event();
        SELECT count(*) INTO count_before FROM public.intake_form_audit_events;
        PERFORM pg_temp.expect_failure(format('SELECT public.save_intake_form_draft(%L,%L,0,%L,%L)', '${admin}', v, '{"changed":true}', '${hash}'), 'Audit write rejected');
        IF (SELECT lock_version FROM public.intake_form_versions WHERE id = v) <> 0
          OR (SELECT definition FROM public.intake_form_versions WHERE id = v) <> '{}'::jsonb THEN RAISE EXCEPTION 'Failed audit committed save'; END IF;
        PERFORM pg_temp.expect_failure(format('SELECT public.discard_intake_form_draft(%L,%L,0)', '${admin}', v), 'Audit write rejected');
        IF NOT EXISTS (SELECT 1 FROM public.intake_form_versions WHERE id = v) THEN RAISE EXCEPTION 'Failed audit committed discard'; END IF;
        PERFORM pg_temp.expect_failure(format('SELECT public.duplicate_intake_form_template(%L,%L,%L,%L,NULL)', '${admin}', v, 'failed_copy', 'Failed copy'), 'Audit write rejected');
        PERFORM pg_temp.expect_failure(format('SELECT public.create_intake_form_template(%L,%L,%L,NULL,%L,%L)', '${admin}', 'failed_create', 'Failed create', '{}', '${hash}'), 'Audit write rejected');
        IF EXISTS (SELECT 1 FROM public.intake_form_templates WHERE key IN ('failed_copy', 'failed_create'))
          OR (SELECT count(*) FROM public.intake_form_audit_events) <> count_before THEN RAISE EXCEPTION 'Failed audit committed creation'; END IF;
      END;
      $test$;
    `)
  })

  it('keeps audit events append-only for application roles', () => {
    checkDatabase(`
      SET LOCAL ROLE service_role;
      DO $test$
      DECLARE privilege_name text;
      BEGIN
        FOREACH privilege_name IN ARRAY ARRAY['SELECT', 'INSERT'] LOOP
          IF NOT pg_catalog.has_table_privilege(current_user, 'public.intake_form_audit_events', privilege_name) THEN RAISE EXCEPTION 'Missing audit privilege %', privilege_name; END IF;
        END LOOP;
        FOREACH privilege_name IN ARRAY ARRAY['UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
          IF pg_catalog.has_table_privilege(current_user, 'public.intake_form_audit_events', privilege_name) THEN RAISE EXCEPTION 'Unsafe audit privilege %', privilege_name; END IF;
        END LOOP;
      END;
      $test$;
      SELECT pg_temp.expect_failure('UPDATE public.intake_form_audit_events SET metadata = metadata', 'permission denied for table intake_form_audit_events');
      SELECT pg_temp.expect_failure('DELETE FROM public.intake_form_audit_events', 'permission denied for table intake_form_audit_events');
    `)
  })
  it('does not grant service_role table privileges that can bypass lifecycle guards', () => {
    checkDatabase(`
      DO $test$
      DECLARE table_name text; privilege_name text;
      BEGIN
        FOREACH table_name IN ARRAY ARRAY['intake_form_templates', 'intake_form_versions'] LOOP
          FOREACH privilege_name IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
            IF NOT pg_catalog.has_table_privilege('service_role', 'public.' || table_name, privilege_name) THEN
              RAISE EXCEPTION 'Missing service_role privilege % on %', privilege_name, table_name;
            END IF;
          END LOOP;
          FOREACH privilege_name IN ARRAY ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
            IF pg_catalog.has_table_privilege('service_role', 'public.' || table_name, privilege_name) THEN
              RAISE EXCEPTION 'Unsafe service_role privilege % on %', privilege_name, table_name;
            END IF;
          END LOOP;
        END LOOP;
      END;
      $test$;
    `)
  })

  it('runs the lifecycle as service_role and rejects stale saves, publish, and discard', () => {
    checkDatabase(`
      SET LOCAL ROLE service_role;
      DO $test$
      DECLARE first jsonb; next jsonb; v uuid; t uuid; r jsonb;
      BEGIN
        first := public.create_intake_form_template('${admin}', 'schema_test', 'Schema test', NULL, '{}', '${hash}');
        v := (first->>'id')::uuid; t := (first->>'template_id')::uuid;
        IF first->>'status' <> 'draft' OR (first->>'version')::integer <> 1 THEN RAISE EXCEPTION 'Bad initial draft'; END IF;
        PERFORM pg_temp.expect_failure(
          format('SELECT public.create_intake_form_template(%L, %L, %L, NULL, %L, %L)', '${admin}', 'schema_test', 'Duplicate', '{}', '${hash}'),
          'duplicate key value violates unique constraint%');
        r := public.save_intake_form_draft('${admin}', v, 0, '{"changed":true}', '${hash}');
        IF (r->>'lock_version')::integer <> 1 THEN RAISE EXCEPTION 'Lock did not advance'; END IF;
        PERFORM pg_temp.expect_failure(format('SELECT public.save_intake_form_draft(%L,%L,0,%L,%L)', '${admin}', v, '{}', '${hash}'), 'Draft changed; refresh and try again');
        IF (SELECT definition FROM public.intake_form_versions WHERE id = v) <> '{"changed":true}'::jsonb THEN RAISE EXCEPTION 'Stale save overwrote draft'; END IF;
        PERFORM pg_temp.expect_failure(format('SELECT public.publish_intake_form_draft(%L,%L,0,%L)', '${admin}', v, '${hash}'), 'Draft changed; refresh and try again');
        PERFORM pg_temp.expect_failure(format('SELECT public.publish_intake_form_draft(%L,%L,1,%L)', '${admin}', v, repeat('b',64)), 'Draft changed; refresh and try again');
        r := public.publish_intake_form_draft('${admin}', v, 1, '${hash}');
        IF r->>'status' <> 'published' OR r->>'published_by' <> '${admin}' OR r->>'published_at' IS NULL THEN RAISE EXCEPTION 'Publication metadata missing'; END IF;
        next := public.create_next_intake_form_draft('${admin}', v);
        IF (next->>'version')::integer <> 2 OR (SELECT definition FROM public.intake_form_versions WHERE id = (next->>'id')::uuid) <> '{"changed":true}'::jsonb THEN RAISE EXCEPTION 'Draft copy is wrong'; END IF;
        PERFORM pg_temp.expect_failure(format('SELECT public.create_next_intake_form_draft(%L,%L)', '${admin}', v), 'Template already has a draft');
        PERFORM pg_temp.expect_failure(format('SELECT public.discard_intake_form_draft(%L,%L,1)', '${admin}', next->>'id'), 'Draft changed; refresh and try again');
        PERFORM public.discard_intake_form_draft('${admin}', (next->>'id')::uuid, 0);
        IF EXISTS (SELECT 1 FROM public.intake_form_versions WHERE id = (next->>'id')::uuid) THEN RAISE EXCEPTION 'Draft was not discarded'; END IF;
        INSERT INTO public.client_intake (form_version_id) VALUES (v);
        r := public.retire_intake_form_version('${admin}', v);
        IF r->>'status' <> 'retired' OR NOT EXISTS (SELECT 1 FROM public.client_intake WHERE form_version_id = v) THEN RAISE EXCEPTION 'Retirement broke pin'; END IF;
        next := public.create_next_intake_form_draft('${admin}', v);
        IF (next->>'version')::integer <> 2 THEN RAISE EXCEPTION 'Retired source copy failed'; END IF;
        PERFORM public.archive_intake_form_template('${admin}', t);
        IF (SELECT status FROM public.intake_form_versions WHERE id = (next->>'id')::uuid) <> 'draft' THEN RAISE EXCEPTION 'Archive changed version status'; END IF;
        PERFORM public.archive_intake_form_template('${admin}', t, false);
        IF (SELECT archived_at FROM public.intake_form_templates WHERE id = t) IS NOT NULL THEN RAISE EXCEPTION 'Unarchive did not clear timestamp'; END IF;
        IF (SELECT status FROM public.intake_form_versions WHERE id = (next->>'id')::uuid) <> 'draft' THEN RAISE EXCEPTION 'Unarchive changed version status'; END IF;
        PERFORM public.archive_intake_form_template('${admin}', t, true);
        PERFORM pg_temp.expect_failure(format('SELECT public.publish_intake_form_draft(%L,%L,0,%L)', '${admin}', next->>'id', '${hash}'), 'Template is archived');
        PERFORM public.discard_intake_form_draft('${admin}', (next->>'id')::uuid, 0);
        PERFORM pg_temp.expect_failure(format('SELECT public.create_next_intake_form_draft(%L,%L)', '${admin}', v), 'Template is archived');
        PERFORM pg_temp.expect_failure(format('DELETE FROM public.intake_form_templates WHERE id = %L', t), 'update or delete on table%violates foreign key constraint%');
        PERFORM pg_temp.expect_failure('INSERT INTO public.client_intake (form_version_id) VALUES (gen_random_uuid())', 'insert or update on table%violates foreign key constraint%');
      END;
      $test$;
    `)
  })

  it('rejects definition, identity, audit, reverse-status, and delete mutations after publication', () => {
    checkDatabase(`
      SET LOCAL ROLE service_role;
      DO $test$
      DECLARE r jsonb; v uuid; assignment text; state text;
      BEGIN
        r := public.create_intake_form_template('${admin}', 'immutability_test', 'Immutable', NULL, '{}', '${hash}');
        v := (r->>'id')::uuid;
        PERFORM public.publish_intake_form_draft('${admin}', v, 0, '${hash}');
        FOREACH state IN ARRAY ARRAY['published', 'retired'] LOOP
          FOREACH assignment IN ARRAY ARRAY[
            'definition = ''{"changed":true}''::jsonb', 'definition_hash = repeat(''b'',64)',
            'template_id = gen_random_uuid()', 'version = 2', 'id = gen_random_uuid()',
            'created_by = ''${attorney}''::uuid', 'published_by = ''${attorney}''::uuid',
            'published_at = now() + interval ''1 second''', 'lock_version = 10'
          ] LOOP
            PERFORM pg_temp.expect_failure(format('UPDATE public.intake_form_versions SET %s WHERE id = %L', assignment, v), 'Published and retired form versions are immutable');
          END LOOP;
          PERFORM pg_temp.expect_failure(format('UPDATE public.intake_form_versions SET status = %L, published_at = NULL, published_by = NULL WHERE id = %L', 'draft', v), 'Published and retired form versions are immutable');
          PERFORM pg_temp.expect_failure(format('DELETE FROM public.intake_form_versions WHERE id = %L', v), 'Published and retired form versions cannot be deleted');
          IF state = 'published' THEN PERFORM public.retire_intake_form_version('${admin}', v); END IF;
        END LOOP;
        PERFORM pg_temp.expect_failure(format('UPDATE public.intake_form_versions SET status = %L WHERE id = %L', 'published', v), 'Only published to retired is an allowed version transition');
      END;
      $test$;
    `)
  })

  it('requires an administrator actor in every privileged lifecycle call', () => {
    const calls = [
      `public.create_intake_form_template(ACTOR, 'actor_test', 'Actor', NULL, '{}', '${hash}')`,
      `public.save_intake_form_draft(ACTOR, gen_random_uuid(), 0, '{}', '${hash}')`,
      `public.create_next_intake_form_draft(ACTOR, gen_random_uuid())`,
      `public.publish_intake_form_draft(ACTOR, gen_random_uuid(), 0, '${hash}')`,
      `public.retire_intake_form_version(ACTOR, gen_random_uuid())`,
      `public.archive_intake_form_template(ACTOR, gen_random_uuid())`,
      `public.discard_intake_form_draft(ACTOR, gen_random_uuid(), 0)`,
      `public.duplicate_intake_form_template(ACTOR, gen_random_uuid(), 'duplicate_test', 'Duplicate', NULL)`,
    ]
    const checks = calls.flatMap((call) => ['NULL', `'${attorney}'`, 'gen_random_uuid()'].map((actor) => {
      const query = `SELECT ${call.replace('ACTOR', actor)}`.replaceAll("'", "''")
      return `SELECT pg_temp.expect_failure('${query}', 'Administrator required');`
    })).join('\n')
    checkDatabase(`SET LOCAL ROLE service_role;\n${checks}`)
  })

  it.each(['anon', 'authenticated'])('denies direct %s reads, writes, and RPC execution', (role) => {
    checkDatabase(`
      SET LOCAL ROLE ${role};
      SELECT pg_temp.expect_failure('SELECT * FROM public.intake_form_templates', 'permission denied for table intake_form_templates');
      SELECT pg_temp.expect_failure('SELECT * FROM public.intake_form_versions', 'permission denied for table intake_form_versions');
      SELECT pg_temp.expect_failure('DELETE FROM public.intake_form_versions', 'permission denied for table intake_form_versions');
      SELECT pg_temp.expect_failure('SELECT * FROM public.intake_form_audit_events', 'permission denied for table intake_form_audit_events');
      SELECT pg_temp.expect_failure('INSERT INTO public.intake_form_audit_events (action) VALUES (''save'')', 'permission denied for table intake_form_audit_events');
      SELECT pg_temp.expect_failure('UPDATE public.intake_form_audit_events SET metadata = metadata', 'permission denied for table intake_form_audit_events');
      SELECT pg_temp.expect_failure('DELETE FROM public.intake_form_audit_events', 'permission denied for table intake_form_audit_events');
      DO $test$
      DECLARE fn record;
      BEGIN
        FOR fn IN SELECT p.oid, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments
          FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = ANY (ARRAY[${[...lifecycleFunctions, 'duplicate_intake_form_template'].map((fn) => `'${fn}'`).join(',')}]) LOOP
          IF pg_catalog.has_function_privilege(current_user, fn.oid, 'EXECUTE') THEN RAISE EXCEPTION 'Browser RPC execution granted: %', fn.proname; END IF;
        END LOOP;
      END;
      $test$;
      SELECT pg_temp.expect_failure('SELECT public.create_intake_form_template(NULL, NULL, NULL, NULL, NULL, NULL)', 'permission denied for function create_intake_form_template');
      SELECT pg_temp.expect_failure('SELECT public.duplicate_intake_form_template(NULL, NULL, NULL, NULL, NULL)', 'permission denied for function duplicate_intake_form_template');
    `)
  })
})
