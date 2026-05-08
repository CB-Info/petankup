-- ============================================================================
-- 0003_phase_a_visibility
-- Pétankup — Phase A : tournois publics listés
--   - Enum public.tournament_visibility ('private', 'public')
--   - Colonne tournaments.visibility NOT NULL DEFAULT 'private'
--   - Helper private.tournament_is_visible_to_current_user(uuid)
--   - Refonte des 3 policies SELECT, avec renommage :
--       tournaments_select_own  → tournaments_select_visible
--       teams_select_own        → teams_select_visible
--       matches_select_own      → matches_select_visible
-- Inchangé : les 9 policies INSERT/UPDATE/DELETE restent strictement
-- owner-only (helper private.tournament_is_owned_by_current_user posé
-- en Phase 0). Aucune autre modification.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Enum tournament_visibility
--    Idempotent via DO block + EXCEPTION : CREATE TYPE n'a pas de
--    IF NOT EXISTS natif en PostgreSQL.
-- ----------------------------------------------------------------------------

do $$
begin
  create type public.tournament_visibility as enum ('private', 'public');
exception
  when duplicate_object then null;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Colonne tournaments.visibility
--    Tous les tournois existants prennent automatiquement 'private' grâce
--    au DEFAULT — comportement Phase 0 strictement préservé tant qu'aucun
--    owner ne bascule explicitement en public.
-- ----------------------------------------------------------------------------

alter table public.tournaments
  add column if not exists visibility public.tournament_visibility
    not null default 'private'::public.tournament_visibility;

-- ----------------------------------------------------------------------------
-- 3. Helper SECURITY DEFINER
--    « Le tournoi <t_id> est-il visible par le user courant ? »
--    Visible = owner OR visibility = 'public'. SECURITY DEFINER pour
--    bypasser la RLS sur tournaments lors des checks transitifs depuis
--    teams/matches ; verrouillé via REVOKE ALL + GRANT EXECUTE ciblé.
-- ----------------------------------------------------------------------------

create or replace function private.tournament_is_visible_to_current_user(t_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.tournaments t
     where t.id = t_id
       and (
         t.owner_id = (select auth.uid())
         or t.visibility = 'public'
       )
  );
$$;

revoke all on function private.tournament_is_visible_to_current_user(uuid)
  from public;

grant execute on function private.tournament_is_visible_to_current_user(uuid)
  to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Refonte des 3 policies SELECT
--    Renommage *_select_own → *_select_visible : le nom devient cohérent
--    avec la nouvelle sémantique (lecture étendue aux publics).
--    Les policies INSERT/UPDATE/DELETE ne sont PAS touchées.
-- ----------------------------------------------------------------------------

-- TOURNAMENTS -----------------------------------------------------------------

drop policy if exists "tournaments_select_own" on public.tournaments;
drop policy if exists "tournaments_select_visible" on public.tournaments;

create policy "tournaments_select_visible"
  on public.tournaments
  for select
  to authenticated
  using (
    owner_id = (select auth.uid())
    or visibility = 'public'
  );

-- TEAMS -----------------------------------------------------------------------

drop policy if exists "teams_select_own" on public.teams;
drop policy if exists "teams_select_visible" on public.teams;

create policy "teams_select_visible"
  on public.teams
  for select
  to authenticated
  using (
    private.tournament_is_visible_to_current_user(teams.tournament_id)
  );

-- MATCHES ---------------------------------------------------------------------

drop policy if exists "matches_select_own" on public.matches;
drop policy if exists "matches_select_visible" on public.matches;

create policy "matches_select_visible"
  on public.matches
  for select
  to authenticated
  using (
    private.tournament_is_visible_to_current_user(matches.tournament_id)
  );
