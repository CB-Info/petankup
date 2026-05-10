-- ============================================================================
-- 0002_phase0_rls_hardening
-- Pétankup — Phase 0 : durcissement RLS
--   - Schéma `private` pour les helpers non exposés en API
--   - Helper SECURITY DEFINER : ownership transitif via tournaments
--   - Toutes les policies existantes refaites :
--       * scope explicite TO authenticated
--       * teams/matches : EXISTS dupliqué remplacé par appel au helper
--       * colonnes de jointure qualifiées (teams.tournament_id,
--         matches.tournament_id)
-- Aucun changement du schéma de données (tables, colonnes, enums,
-- contraintes, indexes, triggers) — comportement fonctionnel préservé.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Schéma `private`
--    Namespace isolé pour les fonctions RLS internes. Non exposé par
--    PostgREST tant qu'il n'est pas ajouté à `db.schema` côté Supabase :
--    le grant USAGE permet l'invocation depuis SQL/policies, pas via API.
-- ----------------------------------------------------------------------------

create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Helper SECURITY DEFINER
--    Factorise le check « le tournoi <t_id> appartient au user courant »
--    utilisé dans les policies de teams et matches. SECURITY DEFINER pour
--    s'exécuter avec les droits du créateur (bypass RLS sur tournaments) ;
--    REVOKE ALL + GRANT EXECUTE explicite verrouillent l'accès.
-- ----------------------------------------------------------------------------

create or replace function private.tournament_is_owned_by_current_user(t_id uuid)
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
       and t.owner_id = (select auth.uid())
  );
$$;

revoke all on function private.tournament_is_owned_by_current_user(uuid)
  from public;

grant execute on function private.tournament_is_owned_by_current_user(uuid)
  to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Refonte des policies existantes
-- ----------------------------------------------------------------------------

-- TOURNAMENTS -----------------------------------------------------------------

drop policy if exists "tournaments_select_own" on public.tournaments;
create policy "tournaments_select_own"
  on public.tournaments
  for select
  to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "tournaments_insert_own" on public.tournaments;
create policy "tournaments_insert_own"
  on public.tournaments
  for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists "tournaments_update_own" on public.tournaments;
create policy "tournaments_update_own"
  on public.tournaments
  for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "tournaments_delete_own" on public.tournaments;
create policy "tournaments_delete_own"
  on public.tournaments
  for delete
  to authenticated
  using (owner_id = (select auth.uid()));

-- TEAMS -----------------------------------------------------------------------

drop policy if exists "teams_select_own" on public.teams;
create policy "teams_select_own"
  on public.teams
  for select
  to authenticated
  using (
    private.tournament_is_owned_by_current_user(teams.tournament_id)
  );

drop policy if exists "teams_insert_own" on public.teams;
create policy "teams_insert_own"
  on public.teams
  for insert
  to authenticated
  with check (
    private.tournament_is_owned_by_current_user(teams.tournament_id)
  );

drop policy if exists "teams_update_own" on public.teams;
create policy "teams_update_own"
  on public.teams
  for update
  to authenticated
  using (
    private.tournament_is_owned_by_current_user(teams.tournament_id)
  )
  with check (
    private.tournament_is_owned_by_current_user(teams.tournament_id)
  );

drop policy if exists "teams_delete_own" on public.teams;
create policy "teams_delete_own"
  on public.teams
  for delete
  to authenticated
  using (
    private.tournament_is_owned_by_current_user(teams.tournament_id)
  );

-- MATCHES ---------------------------------------------------------------------

drop policy if exists "matches_select_own" on public.matches;
create policy "matches_select_own"
  on public.matches
  for select
  to authenticated
  using (
    private.tournament_is_owned_by_current_user(matches.tournament_id)
  );

drop policy if exists "matches_insert_own" on public.matches;
create policy "matches_insert_own"
  on public.matches
  for insert
  to authenticated
  with check (
    private.tournament_is_owned_by_current_user(matches.tournament_id)
  );

drop policy if exists "matches_update_own" on public.matches;
create policy "matches_update_own"
  on public.matches
  for update
  to authenticated
  using (
    private.tournament_is_owned_by_current_user(matches.tournament_id)
  )
  with check (
    private.tournament_is_owned_by_current_user(matches.tournament_id)
  );

drop policy if exists "matches_delete_own" on public.matches;
create policy "matches_delete_own"
  on public.matches
  for delete
  to authenticated
  using (
    private.tournament_is_owned_by_current_user(matches.tournament_id)
  );
