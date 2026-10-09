# LogicDaily — cloud schema (planned Phase 3)

PostgreSQL schema for the cloud mode of LogicDaily, written to mirror the local
IndexedDB records so a future `CloudStore` can implement the same `DataStore`
seam (`lib/db/store.ts`) on top of Postgres.

> **The app does not use this schema yet.** Cloud mode is Phase 3 and is
> intentionally unimplemented: no source file imports Supabase, no UI reads or
> writes these tables, and `LocalStore` (IndexedDB) is the only `DataStore`
> implementation that is wired in. Applying these migrations to a live project
> changes **nothing** in the running product — it creates tables, policies and a
> seeded question bank that no code path touches yet. Nothing here needs to be
> reverted later; it is additive.

## Files

| File | Applied to a real project | Purpose |
| --- | --- | --- |
| `migrations/0000_local_stubs.sql` | **NO — never** | Local validation only. Stubs `auth.users`, `auth.uid()`, `auth.role()` and the `anon` / `authenticated` / `service_role` roles so `0001`/`0002` can be tested against a throwaway Postgres. On real Supabase all of these already exist and are managed; applying it would replace authenticated behaviour with a GUC-trusting fake. |
| `migrations/0001_init.sql` | yes | Tables mirroring `lib/domain/records.ts`, `journal.ts`, `settings.ts`, `exercise-schema.ts`. Snake_case columns, one comment per column naming the TS field it maps to, PKs/FKs, defaults, and indexes matching the Dexie query patterns. |
| `migrations/0002_auth_rls.sql` | yes | `owner_id` isolation: RLS enabled on all 13 tables, four owner-scoped policies per user table, read-only exercise bank. Contains the project's trust-boundary statement. |
| `migrations/0003_seed_exercises.sql` | yes | **Generated.** The shared question bank seeded from `content/exercises/*.json` (112 exercises as of writing). |

No file in this directory contains a key, token or credential. Model-provider
keys are read server-side from env / a secret manager (`.env.example`:
`AI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — un-prefixed, so never bundled into
the browser), and `app_settings.ai` stores only a display label plus cost knobs.
`0001_init.sql` additionally rejects any `apiKey` / `key` / `token` field inside
`app_settings.ai` with a CHECK constraint.

## Applying to a Supabase project

### With the Supabase CLI

```bash
# from the repo root
supabase init                  # only needed once: generates supabase/config.toml.
                               # No config.toml is committed here, so a fresh clone has to run this
                               # (or point the CLI at an existing project directory) before db push.
supabase link --project-ref <project-ref>
supabase db push               # applies 0001, 0002, 0003 — and must NOT include 0000
```

`db push` tracks which migration files are already applied and applies the
pending ones in filename order. Note that it walks **every** file in
`supabase/migrations`, `0000_local_stubs.sql` included — so do the same before
`supabase db reset` and before using a local `supabase start` stack, where the
stub's `create or replace function auth.uid()` would overwrite the real
authenticated implementation. **Before pushing, delete or move
`migrations/0000_local_stubs.sql`** (it is committed only for local validation),
or keep it out of the push by working from a clean checkout of these four files
minus that one. If a real project needs the local test fixtures, they belong in
a separate test-only migration directory, never in `supabase/migrations`.

### With plain psql

```bash
# $DB_URL = postgresql://postgres.<ref>:<password>@<host>:5432/postgres
# run from the repo root, in this order, stopping on the first error
for f in 0001_init 0002_auth_rls 0003_seed_exercises; do
  psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f "supabase/migrations/$f.sql" || exit 1
done
```

`-1` wraps each file in a single transaction, so a failed migration leaves the
database untouched. Skip `0000_local_stubs.sql` — on Supabase `auth.users` and
`auth.uid()` already exist.

`0002` is safe to re-run (it drops and recreates policies). `0003` is safe to
re-run: the generated INSERT uses `ON CONFLICT (id) DO UPDATE`, so it refreshes
existing bank rows instead of failing.

## Regenerating the exercise seed

The seed is generated so the cloud bank cannot drift from the shipped questions.
After adding or editing anything in `content/exercises/*.json`:

```bash
npm run content:validate                                   # schema + answer-key checks
node scripts/export-sql-seed.mjs > supabase/migrations/0003_seed_exercises.sql
```

`scripts/export-sql-seed.mjs` is plain Node with no dependencies. It reads every
`content/exercises/*.json` pack, takes the content tag from
`lib/content/packs.ts` (`EXERCISE_CONTENT_TAG`, stored in
`exercises.seeded_from` — the same value `LocalStore.seedExercises()` uses),
rejects unknown formats / duplicate ids / missing required fields, and writes the
SQL to stdout while printing `N pack files, M exercises` to stderr. It is
GENERATED OUTPUT — edit the JSON and regenerate, do not hand-edit the `.sql`.
Then commit both files, and either push the new migration or re-run `0003`
against the target database (the `ON CONFLICT` upsert makes that a refresh).

To check the seed against the content without a database:

```bash
node -e "const fs=require('fs');let n=0;for(const f of fs.readdirSync('content/exercises'))n+=JSON.parse(fs.readFileSync('content/exercises/'+f)).exercises.length;console.log('exercises on disk:',n)"
grep -c "^  ('ex-" supabase/migrations/0003_seed_exercises.sql
```

Both numbers must match.

## Validating locally (what was run for this schema)

Docker Desktop was not running when this schema was written; the image also
could not be pulled from `registry-1.docker.io` on this network, so the
mirror tag was used and re-tagged locally. Full sequence:

```bash
"/d/Apps/Docker/Docker Desktop.exe" &                      # start the daemon
docker pull docker.m.daocloud.io/library/postgres:16-alpine # direct docker.io pull failed here
docker tag docker.m.daocloud.io/library/postgres:16-alpine postgres:16-alpine
docker run --rm -d --name logicdaily-pg \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=logicdaily \
  -p 55432:5432 postgres:16-alpine
for i in $(seq 1 30); do
  docker exec logicdaily-pg pg_isready -U postgres -d logicdaily && break
  sleep 1
done

docker cp supabase/migrations/. logicdaily-pg:/tmp/migrations
# MSYS_NO_PATHCONV=1 stops Git Bash rewriting /tmp/... into a Windows path
MSYS_NO_PATHCONV=1 docker exec -e PGCLIENTENCODING=UTF8 logicdaily-pg psql \
  -U postgres -d logicdaily -v ON_ERROR_STOP=1 \
  -f /tmp/migrations/0000_local_stubs.sql \
  -f /tmp/migrations/0001_init.sql \
  -f /tmp/migrations/0002_auth_rls.sql \
  -f /tmp/migrations/0003_seed_exercises.sql

docker stop logicdaily-pg                                   # --rm, so it is also removed
```

All four files applied with zero errors and ended in
`GRANT / GRANT / REVOKE / BEGIN / INSERT 0 112 / COMMIT`.

RLS isolation was then proven by acting as two users in one session —
`set role authenticated` (a non-superuser, so RLS applies) plus
`set_config('request.jwt.claims', '{"sub":"<uuid>"}', false)`, which the stub
`auth.uid()` reads exactly the way Supabase's real implementation reads the
gateway-injected claims. With 3 attempts / 2 journals / 3 evidence rows written
by the owner: user A saw `1 / 1 / 1` and user B saw `2 / 1 / 2`, while each saw
all `112` exercises; A's `UPDATE`/`DELETE` of B's row reported `UPDATE 0` /
`DELETE 0` and left B's `score` at 1. Inserting a row for another owner failed
with `new row violates row-level security policy`, all three client writes to
`exercises` failed with `permission denied`, `anon` could read nothing, and
attaching A's evidence to B's journal failed on the composite FK. Full logs and
row counts are in the task report.

## Design notes worth keeping in mind for Phase 3

- **`profileId` → `owner_id`.** Local records carry a `profileId` string; in
  cloud mode that becomes the authenticated user's `uuid`, so it is not
  duplicated as a text column. Multi-profile devices need one login per profile.
- **Timestamps.** A column mapped from a required TS timestamp field is
  `not null` with no default, because the client stamp is the recorded fact and a
  silent `now()` would fabricate history. `updated_at` is never written by a
  trigger: last-write-wins sync (`importBackup`, `upsertJournal`) compares those
  values, so the database must accept the incoming one.
- **`DateKey` → `date`, epoch ms → `timestamptz`, `string[]` → `text[]`.**
- **jsonb vs child tables.** Only `journal_evidence` is a table: its elements
  have their own ids and are individually addressable. `journals.steps`,
  `daily_plans.items` and all exercise sub-objects stay jsonb — reasons are
  written next to each column.
- **No FK from `attempts.exercise_id` / `review_states.exercise_id` /
  `exercise_issue_reports.exercise_id` to `exercises(id)`** — on purpose.
  `seedExercises()` deletes stale bank rows, and answer history plus SRS state
  must survive a question being revised or retired (`exercise_version` records
  what was answered).
- **`exercise_issue_reports` is owner-scoped.** `LocalStore.listIssues()` reads
  every profile's rows as a maintainer queue; in cloud mode that read has to go
  through the service role server-side instead of widening RLS.
- **The bank is global**, not per-user, because the content is versioned in git
  and identical for everyone; clients read it and never write it.
