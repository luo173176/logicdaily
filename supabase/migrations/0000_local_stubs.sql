-- ===========================================================================
-- 0000_local_stubs.sql -- LOCAL VALIDATION ONLY, NEVER APPLY TO REAL SUPABASE
-- ===========================================================================
-- !!! DO NOT RUN THIS FILE AGAINST A REAL SUPABASE PROJECT. !!!
-- Supabase already ships the `auth` schema, the `auth.users` table, the
-- `auth.uid()` function and the `anon` / `authenticated` / `service_role`
-- roles. Applying this file there would either fail (objects already exist)
-- or, worse, overwrite parts of the managed `auth` schema with a fake that
-- trusts a client-settable GUC and therefore breaks authentication.
--
-- Purpose: `0001_init.sql` and `0002_auth_rls.sql` reference `auth.users` and
-- `auth.uid()`. This file provides the smallest possible stand-ins so the
-- cloud migrations can be applied and tested against a throwaway Postgres in
-- Docker. It is deliberately kept in its own file so it is trivial to exclude
-- from `supabase db push` / CI for a real project.
-- ===========================================================================

create schema if not exists auth;

-- Stub of Supabase's auth.users. Only `id` matters for the schema below.
create table if not exists auth.users (
  id uuid primary key,                                       -- references target for owner_id
  created_at timestamptz not null default now()              -- no TS counterpart; shape parity only
);

-- Stub of auth.uid(). Mirrors the real implementation closely enough to be a
-- faithful test: it reads the `sub` claim out of the JWT claims that
-- Supabase's PostgREST/edge layer injects into the `request.jwt.claims` GUC.
-- Because a session GUC is client-settable, this is a TEST SCAFFOLD, not an
-- authentication mechanism -- on real Supabase the claims are injected by the
-- gateway from a verified JWT.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claims', true)::jsonb ->> 'sub',
      current_setting('request.jwt.claim.sub', true)
    ),
    ''
  )::uuid;
$$;

-- Stub of auth.role() (same GUC trick) so policies that report the role work
-- during local validation.
create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    current_setting('request.jwt.claims', true)::jsonb ->> 'role',
    current_setting('request.jwt.role', true),
    'anon'
  );
$$;

-- Postgres-managed pseudo-roles used by Supabase. Created as NOLOGIN/NOINHERIT
-- so tests can `set role authenticated` and thereby stop bypassing RLS the way
-- a superuser does.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon noLOGIN noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated noLOGIN noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role noLOGIN noinherit bypassrls;
  end if;
end
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
