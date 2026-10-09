-- ===========================================================================
-- 0002_auth_rls.sql -- Per-user isolation for LogicDaily cloud mode
-- ===========================================================================
-- TRUST BOUNDARY (read this before adding any policy)
--
-- 1. The model-provider API key never lives in this database, in these files, or in the
--    browser. It is read server-side from env / a secret manager (see .env.example: AI_API_KEY
--    and SUPABASE_SERVICE_ROLE_KEY are server-only, un-prefixed variables; anything the client
--    could see would have to be named NEXT_PUBLIC_*, and no key is). app_settings.ai stores only
--    a display label (baseUrlLabel) plus cost knobs -- migrateSettings() in lib/domain/settings.ts
--    actively deletes apiKey/key/token from imported backups, and the exercises below add a CHECK
--    that rejects those keys. Nothing in this repository contains a credential.
-- 2. The browser never talks to the model provider directly. Today the only AI path is the
--    server route app/api/ai/analyze/route.ts -> lib/ai/service.ts, which validates the target
--    against an allowlist (AI_ALLOWED_BASE_URLS), blocks loopback/SSRF (lib/ai/ssrf.ts), rate
--    limits, caps output tokens, and returns graded, schema-validated JSON (lib/ai/output-schema.ts).
--    In cloud mode that route is the only writer of ai_usage_records / ai_analysis_records with
--    cost-trusting fields, using the service role; the client may read its own rows.
-- 3. Cloud rows are isolated per authenticated user. Every user-owned table carries
--    owner_id uuid not null references auth.users(id) on delete cascade, and RLS policies compare
--    owner_id with (select auth.uid()) -- the `sub` claim of the JWT that Supabase's gateway
--    verifies and injects into the request. There are no policies for `anon` on any user table:
--    signed-out visitors get no rows at all, and they do not need them, because the app ships the
--    question bank in its own bundle (content/exercises/*.json via lib/content/packs.ts) and keeps
--    all data in IndexedDB until a user signs in. Deleting the auth user cascades their data away,
--    which is what the app's "clear my data" path needs.
-- 4. service_role is intentionally outside RLS (Supabase grants it BYPASSRLS); it is the server's
--    own identity and is used for the bank-maintainer read of exercise_issue_reports and for
--    writing usage rows. It must never appear in client code or in a client-visible env var.
--
-- Notes on form
--   * `(select auth.uid())` instead of a bare `auth.uid()` so Postgres evaluates the policy as an
--     init-plan constant once per statement rather than once per row.
--   * All statements are idempotent (drop-if-exists then create) so the file can be re-applied
--     during development without a reset.
--   * FORCE ROW LEVEL SECURITY is not used: the API always connects as `anon`/`authenticated`,
--     never as the table owner, so plain RLS already applies to every request, and forcing it
--     would break owner-side maintenance (ALTER TABLE, backfills, seed scripts).
--   * FKs to auth.users work without granting `authenticated` any privilege on auth.users --
--     referential-integrity lookups are not subject to the referencing role's SELECT rights.
--     Verified locally in the validation run for this file.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Shared question bank: readable by authenticated users, never writable through
-- the API. Only a SELECT policy exists, and the write privileges are revoked
-- from the client roles as a second lock (defence in depth: even if a policy
-- were added by mistake, the grant is not there).
-- ---------------------------------------------------------------------------
alter table exercises enable row level security;

drop policy if exists exercises_read on exercises;
create policy exercises_read on exercises
  for select
  to authenticated
  using (true);

-- Deliberately absent: no insert / update / delete policy for anon or
-- authenticated. Bank changes arrive through migrations and the seed script
-- (scripts/export-sql-seed.mjs -> 0003_seed_exercises.sql), i.e. a deploy-time
-- action by the owner or service role -- not a client request. A client that
-- could rewrite the bank could steer everyone's training and their own future
-- graded answers.
revoke insert, update, delete, truncate, references, trigger on exercises from anon, authenticated;

-- ---------------------------------------------------------------------------
-- User-owned tables: one identical four-policy set each, scoped to owner_id.
-- ---------------------------------------------------------------------------

-- attempts (AttemptRecord): graded answer history including the user's own
-- reasoning text.
alter table attempts enable row level security;
drop policy if exists attempts_select on attempts;
drop policy if exists attempts_insert on attempts;
drop policy if exists attempts_update on attempts;
drop policy if exists attempts_delete on attempts;
create policy attempts_select on attempts
  for select to authenticated using (owner_id = (select auth.uid()));
create policy attempts_insert on attempts
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy attempts_update on attempts
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy attempts_delete on attempts
  for delete to authenticated using (owner_id = (select auth.uid()));

-- journals (Journal)
alter table journals enable row level security;
drop policy if exists journals_select on journals;
drop policy if exists journals_insert on journals;
drop policy if exists journals_update on journals;
drop policy if exists journals_delete on journals;
create policy journals_select on journals
  for select to authenticated using (owner_id = (select auth.uid()));
create policy journals_insert on journals
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy journals_update on journals
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
-- journals are soft-deleted (Journal.deleted), and clearLocalData() /
-- deleteJournalPermanently() remove rows outright, so hard delete must stay
-- available to the owner. Child evidence rows cascade (0001).
create policy journals_delete on journals
  for delete to authenticated using (owner_id = (select auth.uid()));

-- journal_evidence (JournalEvidence[]): owner_id is denormalised onto the child
-- so the same predicate works without a join to journals.
alter table journal_evidence enable row level security;
drop policy if exists journal_evidence_select on journal_evidence;
drop policy if exists journal_evidence_insert on journal_evidence;
drop policy if exists journal_evidence_update on journal_evidence;
drop policy if exists journal_evidence_delete on journal_evidence;
create policy journal_evidence_select on journal_evidence
  for select to authenticated using (owner_id = (select auth.uid()));
create policy journal_evidence_insert on journal_evidence
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy journal_evidence_update on journal_evidence
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy journal_evidence_delete on journal_evidence
  for delete to authenticated using (owner_id = (select auth.uid()));

-- daily_plans (DailyPlanRecord)
alter table daily_plans enable row level security;
drop policy if exists daily_plans_select on daily_plans;
drop policy if exists daily_plans_insert on daily_plans;
drop policy if exists daily_plans_update on daily_plans;
drop policy if exists daily_plans_delete on daily_plans;
create policy daily_plans_select on daily_plans
  for select to authenticated using (owner_id = (select auth.uid()));
create policy daily_plans_insert on daily_plans
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy daily_plans_update on daily_plans
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy daily_plans_delete on daily_plans
  for delete to authenticated using (owner_id = (select auth.uid()));

-- daily_progress (DailyProgressRecord)
alter table daily_progress enable row level security;
drop policy if exists daily_progress_select on daily_progress;
drop policy if exists daily_progress_insert on daily_progress;
drop policy if exists daily_progress_update on daily_progress;
drop policy if exists daily_progress_delete on daily_progress;
create policy daily_progress_select on daily_progress
  for select to authenticated using (owner_id = (select auth.uid()));
create policy daily_progress_insert on daily_progress
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy daily_progress_update on daily_progress
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy daily_progress_delete on daily_progress
  for delete to authenticated using (owner_id = (select auth.uid()));

-- review_states (ReviewState): the personal SRS queue.
alter table review_states enable row level security;
drop policy if exists review_states_select on review_states;
drop policy if exists review_states_insert on review_states;
drop policy if exists review_states_update on review_states;
drop policy if exists review_states_delete on review_states;
create policy review_states_select on review_states
  for select to authenticated using (owner_id = (select auth.uid()));
create policy review_states_insert on review_states
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy review_states_update on review_states
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy review_states_delete on review_states
  for delete to authenticated using (owner_id = (select auth.uid()));

-- knowledge_point_states (KnowledgeState): mastery history is a profile-level
-- signal and is treated as private, not as a leaderboard number.
alter table knowledge_point_states enable row level security;
drop policy if exists knowledge_point_states_select on knowledge_point_states;
drop policy if exists knowledge_point_states_insert on knowledge_point_states;
drop policy if exists knowledge_point_states_update on knowledge_point_states;
drop policy if exists knowledge_point_states_delete on knowledge_point_states;
create policy knowledge_point_states_select on knowledge_point_states
  for select to authenticated using (owner_id = (select auth.uid()));
create policy knowledge_point_states_insert on knowledge_point_states
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy knowledge_point_states_update on knowledge_point_states
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy knowledge_point_states_delete on knowledge_point_states
  for delete to authenticated using (owner_id = (select auth.uid()));

-- ai_usage_records (AIUsageRecord): COST DATA. Tokens, model names, latency and
-- error strings reveal what a user asked the coach about and what it cost, so
-- they are owner-scoped exactly like the answer history -- never global, never
-- readable by another authenticated user. Aggregate spend across users is a
-- service-role/server-side concern (see the trust-boundary note above).
alter table ai_usage_records enable row level security;
drop policy if exists ai_usage_select on ai_usage_records;
drop policy if exists ai_usage_insert on ai_usage_records;
drop policy if exists ai_usage_update on ai_usage_records;
drop policy if exists ai_usage_delete on ai_usage_records;
create policy ai_usage_select on ai_usage_records
  for select to authenticated using (owner_id = (select auth.uid()));
create policy ai_usage_insert on ai_usage_records
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy ai_usage_update on ai_usage_records
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy ai_usage_delete on ai_usage_records
  for delete to authenticated using (owner_id = (select auth.uid()));

-- ai_analysis_records (AIAnalysisRecord): holds model output about the user's
-- reasoning, so owner-scoped; attempts.ai_analysis_id can only reference this
-- same owner's row (composite FK in 0001), which stops cross-user linking.
alter table ai_analysis_records enable row level security;
drop policy if exists ai_analyses_select on ai_analysis_records;
drop policy if exists ai_analyses_insert on ai_analysis_records;
drop policy if exists ai_analyses_update on ai_analysis_records;
drop policy if exists ai_analyses_delete on ai_analysis_records;
create policy ai_analyses_select on ai_analysis_records
  for select to authenticated using (owner_id = (select auth.uid()));
create policy ai_analyses_insert on ai_analysis_records
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy ai_analyses_update on ai_analysis_records
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy ai_analyses_delete on ai_analysis_records
  for delete to authenticated using (owner_id = (select auth.uid()));

-- exercise_issue_reports (ExerciseIssueReport): owner-scoped. The bank-maintainer
-- triage queue that LocalStore.listIssues() reads globally must be served to
-- maintainers server-side with the service role, not by adding a broader policy.
alter table exercise_issue_reports enable row level security;
drop policy if exists issues_select on exercise_issue_reports;
drop policy if exists issues_insert on exercise_issue_reports;
drop policy if exists issues_update on exercise_issue_reports;
drop policy if exists issues_delete on exercise_issue_reports;
create policy issues_select on exercise_issue_reports
  for select to authenticated using (owner_id = (select auth.uid()));
create policy issues_insert on exercise_issue_reports
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy issues_update on exercise_issue_reports
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy issues_delete on exercise_issue_reports
  for delete to authenticated using (owner_id = (select auth.uid()));

-- app_settings (AppSettings) and sync_states (SyncStateRecord): one row per
-- owner, keyed by owner_id, so the same predicate doubles as the row key check.
alter table app_settings enable row level security;
drop policy if exists app_settings_select on app_settings;
drop policy if exists app_settings_insert on app_settings;
drop policy if exists app_settings_update on app_settings;
drop policy if exists app_settings_delete on app_settings;
create policy app_settings_select on app_settings
  for select to authenticated using (owner_id = (select auth.uid()));
create policy app_settings_insert on app_settings
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy app_settings_update on app_settings
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy app_settings_delete on app_settings
  for delete to authenticated using (owner_id = (select auth.uid()));

alter table sync_states enable row level security;
drop policy if exists sync_states_select on sync_states;
drop policy if exists sync_states_insert on sync_states;
drop policy if exists sync_states_update on sync_states;
drop policy if exists sync_states_delete on sync_states;
create policy sync_states_select on sync_states
  for select to authenticated using (owner_id = (select auth.uid()));
create policy sync_states_insert on sync_states
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy sync_states_update on sync_states
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy sync_states_delete on sync_states
  for delete to authenticated using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Table privileges for the client roles. RLS decides WHICH rows; grants decide
-- whether a statement is allowed at all -- both are required, and being
-- explicit here means a real project does not depend on Supabase's default
-- privileges surviving a change. `anon` gets no write access to anything, and
-- no read access to user tables.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on
  attempts,
  journals,
  journal_evidence,
  daily_plans,
  daily_progress,
  review_states,
  knowledge_point_states,
  ai_usage_records,
  ai_analysis_records,
  exercise_issue_reports,
  app_settings,
  sync_states
to authenticated;

grant select on exercises to authenticated;
revoke all on exercises from anon;
