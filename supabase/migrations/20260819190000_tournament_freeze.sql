-- ============================================================================
-- 20260819190000_tournament_freeze
-- Pétankup — H1.a : gel des tournois terminés (prédicat de gel unifié).
--
-- Ferme la faille d'intégrité documentée en dette consciente par la Phase I
-- (20260609180000_phase_i_stats_db.sql l.49-51) : un score modifié après
-- complétion ne re-matérialisait pas les stats → divergence silencieuse
-- possible entre user_tournament_results/user_stats et les données réelles.
--
-- Contenu :
--   Bloc 1 : prédicat private.tournament_is_frozen (point d'application unique).
--   Bloc 2 : guards de gel sur les policies d'écriture de teams, matches,
--            team_players (USING et WITH CHECK).
--   Bloc 3 : trigger BEFORE UPDATE tournaments_freeze_guard — sous completed,
--            seules la réouverture (vers in_progress) et la visibilité restent
--            mutables ; toute autre colonne est gelée (diff jsonb).
--   Bloc 4 : extension de set_completed_at_on_completion — completed_at
--            repasse à NULL à la réouverture (prérequis de la CHECK
--            tournaments_completed_at_consistency).
--   Bloc 5 : gates de gel dans les RPC DEFINER create_team_with_players et
--            update_team_with_players (les DEFINER contournent la RLS).
--   Bloc 6 : dématérialisation factorisée (fonction commune) + trigger de
--            réouverture (retrait des stats matérialisées).
--
-- Décisions actées (cadrage H1.a) :
--   - completed n'est PAS terminal : l'owner peut rouvrir pour corriger une
--     erreur de saisie (rouvrir → corriger → re-terminer). La réouverture est
--     restreinte à completed → in_progress (un retour en draft créerait un
--     état incohérent : matchs joués existants sous un statut « équipes
--     éditables, matchs non générés »).
--   - Sous completed, le changement de visibility seul reste permis (partager
--     les résultats d'un tournoi fini est légitime).
--   - La suppression d'un tournoi completed reste permise (statu quo) : la
--     dématérialisation BEFORE DELETE de la Phase I garantit déjà la
--     cohérence des stats ; supprimer n'est pas modifier un score.
--   - Code d'erreur UNIQUE 'tournament_completed' pour le concept « tournoi
--     terminé = intouchable » — trigger compris, aligné sur les gates
--     existantes (phase_b_4, phase_e, phase_g_1).
--   - À la re-complétion, completed_at est reposé à now() (frais) : le
--     tournoi « rajeunit » dans les journaux de profil — cohérent, l'ancien
--     état a été dématérialisé à la réouverture.
--
-- Invariants à préserver :
--   - AUCUN trigger BEFORE UPDATE ne doit jamais assigner new.status : les
--     triggers AFTER UPDATE OF status (matérialisation, dématérialisation)
--     deviendraient aveugles à un changement de statut qu'ils n'ont pas vu
--     dans la liste de colonnes du SET.
--   - private.tournament_is_frozen ne doit JAMAIS être appelé depuis une
--     policy de public.tournaments elle-même (précédent de récursion
--     documenté en phase_b_1 : helper DEFINER lisant tournaments depuis une
--     policy de tournaments). Le gel de la ligne tournoi passe par trigger.
--   - Les WHEN des triggers de matérialisation (new completed, old distinct)
--     et de réouverture (old completed, new distinct) sont disjointes :
--     jamais de double fire sur un même UPDATE.
--
-- Rappels schéma à NE PAS casser :
--   - L'app ré-envoie TOUTES les colonnes mutables à chaque UPDATE de
--     tournaments (mapper update) : le gel compare les VALEURS old/new
--     (diff jsonb), jamais la présence de colonnes dans le SET.
--   - Les actions référentielles ON DELETE CASCADE contournent la RLS : la
--     suppression d'un tournoi completed cascade sans friction avec les
--     guards de gel des tables enfants.
--
-- Horizon 2 (matchs libres) : le match libre est immuable structurellement
-- (aucun chemin d'écriture, cf. docs/conception_matchs_libres.md §3.4) — le
-- prédicat ne gagne PAS de second déclencheur (commentaire corrigé en H2.a).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bloc 1 : prédicat de gel — point d'application unique.
-- Déclencheur unique = tournoi parent terminé.
-- ----------------------------------------------------------------------------

create or replace function private.tournament_is_frozen(p_tournament_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.tournaments t
     where t.id = p_tournament_id
       and t.status = 'completed'
  );
$$;

revoke all on function private.tournament_is_frozen(uuid) from public;
grant execute on function private.tournament_is_frozen(uuid) to authenticated;

comment on function private.tournament_is_frozen(uuid) is
  'Gel : tournoi parent terminé. Le match libre (Horizon 2) est immuable '
  'structurellement — aucun chemin d''écriture — donc pas de second déclencheur. '
  'Ne JAMAIS appeler depuis une policy de public.tournaments (récursion, '
  'cf. phase_b_1) — le gel de la ligne tournoi passe par trigger.';

-- ----------------------------------------------------------------------------
-- Bloc 2 : gel par les policies d'écriture (teams, matches, team_players).
-- Guard posé dans USING ET WITH CHECK pour UPDATE : WITH CHECK seul
-- laisserait extraire une ligne d'un tournoi gelé en re-parentant
-- (tournament_id, team_a_id, team_b_id) ensemble vers un tournoi non gelé
-- (les composite FKs ne l'empêchent pas si les trois colonnes changent).
-- Sémantique des échecs directs : UPDATE/DELETE = no-op silencieux (USING
-- filtre), INSERT = erreur 42501 (WITH CHECK) — asymétrie assumée, même
-- précédent que phase_b_4 (RPC = code métier typé, direct = denial).
-- Le SELECT ne change pas. Noms de policies conservés (drop + create,
-- PostgreSQL n'a pas de CREATE OR REPLACE POLICY).
-- ----------------------------------------------------------------------------

-- TEAMS ------------------------------------------------------------------------

drop policy if exists "teams_insert_own" on public.teams;
create policy "teams_insert_own"
  on public.teams
  for insert
  to authenticated
  with check (
    private.tournament_is_owned_by_current_user(teams.tournament_id)
    and not private.tournament_is_frozen(teams.tournament_id)
  );

drop policy if exists "teams_update_own" on public.teams;
create policy "teams_update_own"
  on public.teams
  for update
  to authenticated
  using (
    private.tournament_is_owned_by_current_user(teams.tournament_id)
    and not private.tournament_is_frozen(teams.tournament_id)
  )
  with check (
    private.tournament_is_owned_by_current_user(teams.tournament_id)
    and not private.tournament_is_frozen(teams.tournament_id)
  );

drop policy if exists "teams_delete_own" on public.teams;
create policy "teams_delete_own"
  on public.teams
  for delete
  to authenticated
  using (
    private.tournament_is_owned_by_current_user(teams.tournament_id)
    and not private.tournament_is_frozen(teams.tournament_id)
  );

-- MATCHES ---------------------------------------------------------------------

drop policy if exists "matches_insert_own" on public.matches;
create policy "matches_insert_own"
  on public.matches
  for insert
  to authenticated
  with check (
    private.tournament_is_owned_by_current_user(matches.tournament_id)
    and not private.tournament_is_frozen(matches.tournament_id)
  );

drop policy if exists "matches_update_own" on public.matches;
create policy "matches_update_own"
  on public.matches
  for update
  to authenticated
  using (
    private.tournament_is_owned_by_current_user(matches.tournament_id)
    and not private.tournament_is_frozen(matches.tournament_id)
  )
  with check (
    private.tournament_is_owned_by_current_user(matches.tournament_id)
    and not private.tournament_is_frozen(matches.tournament_id)
  );

drop policy if exists "matches_delete_own" on public.matches;
create policy "matches_delete_own"
  on public.matches
  for delete
  to authenticated
  using (
    private.tournament_is_owned_by_current_user(matches.tournament_id)
    and not private.tournament_is_frozen(matches.tournament_id)
  );

-- TEAM_PLAYERS ------------------------------------------------------------------
-- Policy FOR ALL : le guard dans USING retire aussi le chemin de lecture
-- owner de CETTE policy sous gel, mais la lecture reste couverte par
-- team_players_select_visible (policies permissives OR-ées) — aucun
-- changement de visibilité en lecture.

drop policy if exists "team_players_modify_owner" on public.team_players;
create policy "team_players_modify_owner"
  on public.team_players
  for all
  to authenticated
  using (
    private.tournament_is_owned_by_current_user(tournament_id)
    and not private.tournament_is_frozen(tournament_id)
  )
  with check (
    private.tournament_is_owned_by_current_user(tournament_id)
    and not private.tournament_is_frozen(tournament_id)
  );

-- ----------------------------------------------------------------------------
-- Bloc 3 : gel de la ligne tournoi elle-même — trigger BEFORE UPDATE.
-- La RLS ne sait pas comparer OLD/NEW colonne par colonne ; le trigger si.
--
-- Sous completed, trois issues :
--   a) réouverture vers in_progress → tout passe (le statement quitte le gel,
--      les triggers AFTER dématérialisent — geler les autres colonnes ici
--      n'apporterait rien : le flux légitime est précisément « rouvrir puis
--      corriger »).
--   b) toute autre transition de statut (completed → draft) → refusée.
--   c) statut inchangé → seules visibility et updated_at (écrasé par
--      set_updated_at de toute façon) peuvent différer. Comparaison par
--      diff jsonb : gel PAR DÉFAUT de toute colonne actuelle et future
--      (completed_at compris — le trigger set_completed_at ne le protège
--      que sur les transitions, il serait falsifiable sans ce diff).
--
-- INVOKER (défaut) : ne lit que OLD/NEW, aucun accès table — même choix que
-- set_completed_at_on_completion. Ordre alphabétique des BEFORE UPDATE :
-- tournaments_freeze_guard < tournaments_set_completed_at <
-- tournaments_set_updated_at — le guard voit le NEW brut du statement.
-- Aucune dépendance dure à cet ordre : les deux autres triggers sont no-op
-- dans la branche gardée (statut inchangé).
-- ----------------------------------------------------------------------------

create or replace function private.tournament_freeze_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status is distinct from 'completed' then
    return new;
  end if;

  if new.status is distinct from 'completed' then
    -- Sortie de gel : seule la réouverture vers in_progress est permise.
    if new.status is distinct from 'in_progress' then
      raise exception 'tournament_completed';
    end if;
    return new;
  end if;

  -- completed → completed : tout est gelé sauf visibility (décision produit)
  -- et updated_at (écrasé par le trigger set_updated_at).
  if (to_jsonb(old) - 'visibility' - 'updated_at')
     is distinct from (to_jsonb(new) - 'visibility' - 'updated_at') then
    raise exception 'tournament_completed';
  end if;

  return new;
end;
$$;

revoke all on function private.tournament_freeze_guard() from public;

drop trigger if exists tournaments_freeze_guard on public.tournaments;
create trigger tournaments_freeze_guard
  before update on public.tournaments
  for each row execute function private.tournament_freeze_guard();

-- ----------------------------------------------------------------------------
-- Bloc 4 : extension de set_completed_at_on_completion — la réouverture
-- remet completed_at à NULL. PRÉREQUIS de la CHECK
-- tournaments_completed_at_consistency ((status='completed') =
-- (completed_at is not null)) : sans cette branche, toute réouverture
-- violerait la CHECK avant même les triggers AFTER. La CHECK reste en
-- place comme failsafe. Grants existants préservés par le replace.
-- ----------------------------------------------------------------------------

create or replace function private.set_completed_at_on_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    new.completed_at = now();
  elsif old.status = 'completed' and new.status is distinct from 'completed' then
    new.completed_at = null;
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- Bloc 5 : gates de gel dans les RPC DEFINER d'écriture équipes. Les
-- SECURITY DEFINER contournent la RLS du Bloc 2 : le gel doit vivre DANS
-- les corps. Gate posé APRÈS not_owner (anti-leak de statut aux
-- non-owners, précédent phase_b_4). Corps repris verbatim de phase_g_1,
-- seul le gate est inséré. Les RPC membres (invite/remove) portent déjà
-- leur gate tournament_completed — inchangées. Wrappers publics et grants
-- inchangés (préservés par le replace).
-- ----------------------------------------------------------------------------

create or replace function private.create_team_with_players(
  p_tournament_id uuid,
  p_name text,
  p_players jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_team_id uuid;
  v_player jsonb;
  v_user_id uuid;
  v_display_name text;
begin
  v_caller_id := (select auth.uid());
  if v_caller_id is null then
    raise exception 'not_authenticated';
  end if;

  if not exists (
    select 1 from public.tournaments t
     where t.id = p_tournament_id and t.owner_id = v_caller_id
  ) then
    raise exception 'not_owner';
  end if;

  if private.tournament_is_frozen(p_tournament_id) then
    raise exception 'tournament_completed';
  end if;

  if p_players is null
     or jsonb_typeof(p_players) <> 'array'
     or jsonb_array_length(p_players) < 1
     or jsonb_array_length(p_players) > 3 then
    raise exception 'invalid_player_count';
  end if;

  insert into public.teams (tournament_id, name)
  values (p_tournament_id, p_name)
  returning id into v_team_id;

  for v_player in select value from jsonb_array_elements(p_players)
  loop
    v_user_id := nullif(v_player->>'user_id', '')::uuid;

    if v_user_id is not null then
      -- Le joueur lié doit être owner ou membre du tournoi (anti-fuite de
      -- pseudo + invariant Q12/Q13).
      if not (
        exists (
          select 1 from public.tournaments t
           where t.id = p_tournament_id and t.owner_id = v_user_id
        )
        or exists (
          select 1 from public.tournament_members m
           where m.tournament_id = p_tournament_id and m.user_id = v_user_id
        )
      ) then
        raise exception 'player_not_in_tournament';
      end if;

      select p.display_name into v_display_name
        from public.profiles p
       where p.id = v_user_id;
      if v_display_name is null then
        raise exception 'player_user_not_found';
      end if;
    else
      v_display_name := left(trim(v_player->>'display_name'), 50);
    end if;

    insert into public.team_players (team_id, tournament_id, user_id, display_name)
    values (v_team_id, p_tournament_id, v_user_id, v_display_name);
  end loop;

  return v_team_id;
end;
$$;

create or replace function private.update_team_with_players(
  p_team_id uuid,
  p_name text,
  p_players jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_tournament_id uuid;
  v_player jsonb;
  v_user_id uuid;
  v_display_name text;
begin
  v_caller_id := (select auth.uid());
  if v_caller_id is null then
    raise exception 'not_authenticated';
  end if;

  select t.tournament_id into v_tournament_id
    from public.teams t
   where t.id = p_team_id;
  if v_tournament_id is null then
    raise exception 'team_not_found';
  end if;

  if not exists (
    select 1 from public.tournaments t
     where t.id = v_tournament_id and t.owner_id = v_caller_id
  ) then
    raise exception 'not_owner';
  end if;

  if private.tournament_is_frozen(v_tournament_id) then
    raise exception 'tournament_completed';
  end if;

  if p_players is null
     or jsonb_typeof(p_players) <> 'array'
     or jsonb_array_length(p_players) < 1
     or jsonb_array_length(p_players) > 3 then
    raise exception 'invalid_player_count';
  end if;

  update public.teams set name = p_name where id = p_team_id;

  delete from public.team_players where team_id = p_team_id;

  for v_player in select value from jsonb_array_elements(p_players)
  loop
    v_user_id := nullif(v_player->>'user_id', '')::uuid;

    if v_user_id is not null then
      if not (
        exists (
          select 1 from public.tournaments t
           where t.id = v_tournament_id and t.owner_id = v_user_id
        )
        or exists (
          select 1 from public.tournament_members m
           where m.tournament_id = v_tournament_id and m.user_id = v_user_id
        )
      ) then
        raise exception 'player_not_in_tournament';
      end if;

      select p.display_name into v_display_name
        from public.profiles p
       where p.id = v_user_id;
      if v_display_name is null then
        raise exception 'player_user_not_found';
      end if;
    else
      v_display_name := left(trim(v_player->>'display_name'), 50);
    end if;

    insert into public.team_players (team_id, tournament_id, user_id, display_name)
    values (p_team_id, v_tournament_id, v_user_id, v_display_name);
  end loop;

  return p_team_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Bloc 6 : dématérialisation factorisée + trigger de réouverture.
-- La logique capture users → delete → recompute (ordre critique : delete
-- AVANT recompute, cf. phase_i) est extraite de on_tournament_deleted dans
-- une fonction commune, appelée par le trigger DELETE existant (réécrit)
-- et par le nouveau trigger de réouverture. La re-complétion re-matérialise
-- via le trigger existant tournaments_materialize_on_complete — rien à
-- ajouter.
-- ----------------------------------------------------------------------------

create or replace function private.dematerialize_tournament_results(
  p_tournament_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_affected_users uuid[];
  v_user uuid;
begin
  select array_agg(distinct user_id)
    into v_affected_users
    from public.user_tournament_results
   where tournament_id = p_tournament_id;

  delete from public.user_tournament_results
   where tournament_id = p_tournament_id;

  if v_affected_users is not null then
    foreach v_user in array v_affected_users loop
      perform private.recompute_user_stats(v_user);
    end loop;
  end if;
end;
$$;

revoke all on function private.dematerialize_tournament_results(uuid) from public;

create or replace function private.on_tournament_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.dematerialize_tournament_results(old.id);
  return old;
end;
$$;

create or replace function private.on_tournament_reopened()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.dematerialize_tournament_results(old.id);
  return null;
end;
$$;

revoke all on function private.on_tournament_reopened() from public;

drop trigger if exists tournaments_dematerialize_on_reopen on public.tournaments;
create trigger tournaments_dematerialize_on_reopen
  after update of status on public.tournaments
  for each row
  when (old.status = 'completed' and new.status is distinct from 'completed')
  execute function private.on_tournament_reopened();
