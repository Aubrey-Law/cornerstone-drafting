// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const migrations = resolve(process.cwd(), 'supabase/migrations')
const files = readdirSync(migrations).filter((name) => name.endsWith('_intake_form_builder_foundation.sql'))
const sql = files.length === 1 ? readFileSync(resolve(migrations, files[0]), 'utf8') : ''
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
    ('${attorney}', 'form-schema-attorney@example.test');
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
      DO $test$
      DECLARE fn record;
      BEGIN
        FOR fn IN SELECT p.oid, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments
          FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = ANY (ARRAY[${lifecycleFunctions.map((fn) => `'${fn}'`).join(',')}]) LOOP
          IF pg_catalog.has_function_privilege(current_user, fn.oid, 'EXECUTE') THEN RAISE EXCEPTION 'Browser RPC execution granted: %', fn.proname; END IF;
        END LOOP;
      END;
      $test$;
      SELECT pg_temp.expect_failure('SELECT public.create_intake_form_template(NULL, NULL, NULL, NULL, NULL, NULL)', 'permission denied for function create_intake_form_template');
    `)
  })
})
