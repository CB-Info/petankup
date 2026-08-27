-- ============================================================================
-- tournament_freeze_check.sql — vérification manuelle du gel des tournois
-- terminés (migration 20260819190000_tournament_freeze).
--
-- HORS CI : pas d'infra DB de test dans ce projet. À exécuter à la main dans
-- le SQL Editor de Supabase Studio (ou psql sur la stack locale `supabase
-- start`). Tout est encadré par begin/rollback : aucune ligne ne reste en
-- base. Si une assertion échoue, un raise exception interrompt le script —
-- la transaction avortée annule tout de toute façon.
--
-- Synchro manuelle : les scénarios couvrent les cas du ticket H1.a §4. Toute
-- évolution du gel (nouveau déclencheur Horizon 2, nouvelle colonne exemptée)
-- doit être répercutée ici À LA MAIN.
--
-- Simulation d'identité :
--   - request.jwt.claims (set_config transaction-local) alimente auth.uid()
--     dans les RPC SECURITY DEFINER — pas besoin de changer de rôle.
--   - set local role authenticated / reset role éprouve la RLS réelle
--     (postgres est membre de authenticated dans les projets Supabase ; si
--     un vieux projet refuse le SET ROLE, exécuter d'abord :
--     grant authenticated to postgres;).
--
-- Sémantique attendue des échecs (asymétrie assumée, précédent phase_b_4) :
--   - RPC DEFINER            → raise exception 'tournament_completed' (P0001)
--   - trigger tournoi        → raise exception 'tournament_completed' (P0001)
--   - INSERT direct sous gel → 42501 (RLS WITH CHECK)
--   - UPDATE/DELETE direct   → no-op silencieux, 0 ligne (RLS USING filtre)
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- Parité d'environnement : sur le projet hébergé, authenticated a les
-- privilèges DML sur les tables applicatives (grants par défaut du projet) —
-- ces GRANT y sont des no-ops. Sur une stack locale `supabase db start`,
-- la baseline de l'image ne les pose pas : on les pose ici, DANS la
-- transaction (annulés par le rollback final). Volontairement PAS de grant
-- sur user_tournament_results / user_stats (deny-total de la Phase I).
-- ----------------------------------------------------------------------------

grant select, insert, update, delete
  on public.tournaments, public.teams, public.tournament_matches,
     public.team_players, public.tournament_members, public.profiles
  to authenticated;

-- ----------------------------------------------------------------------------
-- Helpers d'assertion (pg_temp : jetés au rollback / fin de session).
-- ----------------------------------------------------------------------------

create function pg_temp.assert_eq_int(
  p_actual bigint,
  p_expected bigint,
  p_label text
) returns void
language plpgsql
as $$
begin
  if p_actual is distinct from p_expected then
    raise exception '[%] attendu %, obtenu %', p_label, p_expected, p_actual;
  end if;
end;
$$;

-- Exécute p_sql et exige un échec. p_expected_sqlstate / p_expected_message :
-- null = ne pas vérifier ce champ.
create function pg_temp.assert_blocked(
  p_sql text,
  p_expected_sqlstate text,
  p_expected_message text,
  p_label text
) returns void
language plpgsql
as $$
declare
  v_state text;
  v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics
      v_state = returned_sqlstate,
      v_msg = message_text;
    if p_expected_sqlstate is not null and v_state <> p_expected_sqlstate then
      raise exception '[%] bloqué mais mauvais sqlstate : % (attendu %, message « % »)',
        p_label, v_state, p_expected_sqlstate, v_msg;
    end if;
    if p_expected_message is not null and v_msg <> p_expected_message then
      raise exception '[%] bloqué mais mauvais message : « % » (attendu « % », sqlstate %)',
        p_label, v_msg, p_expected_message, v_state;
    end if;
    return;
  end;
  raise exception '[%] PAS bloqué : le statement a réussi', p_label;
end;
$$;

-- Exécute un UPDATE/DELETE et vérifie le nombre de lignes affectées
-- (0 = no-op silencieux RLS, 1 = écriture passée).
create function pg_temp.assert_row_count(
  p_sql text,
  p_expected int,
  p_label text
) returns void
language plpgsql
as $$
declare
  v_count int;
begin
  execute p_sql;
  get diagnostics v_count = row_count;
  if v_count <> p_expected then
    raise exception '[%] attendu % ligne(s) affectée(s), obtenu %',
      p_label, p_expected, v_count;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- Fixtures (en postgres, owner des tables : bypass RLS, comme le harnais
-- ranking). Le trigger handle_new_user_profile crée les profiles.
-- T1 : tournoi qui sera gelé (1 match complété 13-7, A bat B).
-- T2 : tournoi in_progress pour la non-régression (1 match pending).
-- ----------------------------------------------------------------------------

insert into auth.users (id, email, aud, role, created_at, updated_at) values
  ('d0000000-0000-4000-8000-000000000001', 'freeze-owner@petankup.test',  'authenticated', 'authenticated', now(), now()),
  ('d0000000-0000-4000-8000-000000000002', 'freeze-player@petankup.test', 'authenticated', 'authenticated', now(), now());

insert into public.tournaments (id, owner_id, name, date, status) values
  ('f1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'freeze-check-gele',       current_date, 'draft'),
  ('f1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'freeze-check-inprogress', current_date, 'draft');

insert into public.teams (id, tournament_id, name) values
  ('a1111111-1111-4111-8111-000000000001', 'f1000000-0000-4000-8000-000000000001', 'Alpha'),
  ('b1111111-1111-4111-8111-000000000001', 'f1000000-0000-4000-8000-000000000001', 'Bravo'),
  ('a1111111-1111-4111-8111-000000000002', 'f1000000-0000-4000-8000-000000000002', 'Alpha'),
  ('b1111111-1111-4111-8111-000000000002', 'f1000000-0000-4000-8000-000000000002', 'Bravo');

insert into public.team_players (team_id, tournament_id, user_id, display_name) values
  ('a1111111-1111-4111-8111-000000000001', 'f1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'freeze-owner'),
  ('b1111111-1111-4111-8111-000000000001', 'f1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', 'freeze-player');

insert into public.tournament_matches (tournament_id, team_a_id, team_b_id, score_a, score_b, winner_id, status, round_number) values
  ('f1000000-0000-4000-8000-000000000001', 'a1111111-1111-4111-8111-000000000001', 'b1111111-1111-4111-8111-000000000001', 13, 7, 'a1111111-1111-4111-8111-000000000001', 'completed', 1),
  ('f1000000-0000-4000-8000-000000000002', 'a1111111-1111-4111-8111-000000000002', 'b1111111-1111-4111-8111-000000000002', null, null, null, 'pending', 1);

-- Complétion de T1 (matérialise les stats) ; T2 passe in_progress.
update public.tournaments set status = 'completed'
 where id = 'f1000000-0000-4000-8000-000000000001';
update public.tournaments set status = 'in_progress'
 where id = 'f1000000-0000-4000-8000-000000000002';

-- Sanity : la matérialisation initiale a bien produit 2 lignes.
select pg_temp.assert_eq_int(
  (select count(*) from public.user_tournament_results
    where tournament_id = 'f1000000-0000-4000-8000-000000000001'),
  2, 'setup: matérialisation initiale');

-- Identité simulée = owner, pour auth.uid() (RPC) et la RLS (role authenticated).
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd0000000-0000-4000-8000-000000000001',
                    'role', 'authenticated')::text,
  true);

-- ----------------------------------------------------------------------------
-- Cas 1 — matchs d'un tournoi gelé : UPDATE = no-op (USING), INSERT = 42501.
-- ----------------------------------------------------------------------------

set local role authenticated;

select pg_temp.assert_row_count(
  $sql$ update public.tournament_matches set score_a = 13, score_b = 5
         where tournament_id = 'f1000000-0000-4000-8000-000000000001' $sql$,
  0, 'cas 1a: UPDATE score sous gel = no-op');

select pg_temp.assert_blocked(
  $sql$ insert into public.tournament_matches (tournament_id, team_a_id, team_b_id, status, round_number)
        values ('f1000000-0000-4000-8000-000000000001',
                'a1111111-1111-4111-8111-000000000001',
                'b1111111-1111-4111-8111-000000000001',
                'pending', 2) $sql$,
  '42501', null, 'cas 1b: INSERT match sous gel');

reset role;

-- Non-mutation vérifiée en postgres (bypass RLS) : le score est intact.
select pg_temp.assert_eq_int(
  (select score_b from public.tournament_matches
    where tournament_id = 'f1000000-0000-4000-8000-000000000001'),
  7, 'cas 1a: score intact après le no-op');

-- ----------------------------------------------------------------------------
-- Cas 2 — RPC équipes sous gel : erreur typée tournament_completed.
-- (En postgres : les wrappers INVOKER délèguent aux DEFINER, auth.uid() lit
-- les claims posés ci-dessus.)
-- ----------------------------------------------------------------------------

select pg_temp.assert_blocked(
  $sql$ select public.update_team_with_players(
          'a1111111-1111-4111-8111-000000000001', 'Alpha renommee',
          '[{"user_id": null, "display_name": "Libre"}]'::jsonb) $sql$,
  'P0001', 'tournament_completed', 'cas 2a: update_team_with_players sous gel');

select pg_temp.assert_blocked(
  $sql$ select public.create_team_with_players(
          'f1000000-0000-4000-8000-000000000001', 'Charlie',
          '[{"user_id": null, "display_name": "Libre"}]'::jsonb) $sql$,
  'P0001', 'tournament_completed', 'cas 2b: create_team_with_players sous gel');

-- ----------------------------------------------------------------------------
-- Cas 3 — ligne tournoi sous gel (trigger) : tout est gelé sauf visibility ;
-- completed → draft refusé. Code unifié tournament_completed.
-- ----------------------------------------------------------------------------

set local role authenticated;

select pg_temp.assert_blocked(
  $sql$ update public.tournaments set name = 'nouveau nom'
         where id = 'f1000000-0000-4000-8000-000000000001' $sql$,
  'P0001', 'tournament_completed', 'cas 3a: UPDATE nom sous gel');

select pg_temp.assert_blocked(
  $sql$ update public.tournaments set completed_at = now() - interval '1 year'
         where id = 'f1000000-0000-4000-8000-000000000001' $sql$,
  'P0001', 'tournament_completed', 'cas 3b: falsification completed_at');

select pg_temp.assert_blocked(
  $sql$ update public.tournaments set status = 'draft'
         where id = 'f1000000-0000-4000-8000-000000000001' $sql$,
  'P0001', 'tournament_completed', 'cas 3c: réouverture vers draft refusée');

select pg_temp.assert_row_count(
  $sql$ update public.tournaments set visibility = 'public'
         where id = 'f1000000-0000-4000-8000-000000000001' $sql$,
  1, 'cas 3d: visibility seule modifiable sous gel');

reset role;

select pg_temp.assert_eq_int(
  (select count(*) from public.tournaments
    where id = 'f1000000-0000-4000-8000-000000000001'
      and visibility = 'public' and name = 'freeze-check-gele'),
  1, 'cas 3d: visibility changée, nom intact');

-- ----------------------------------------------------------------------------
-- Cas 4 — réouverture (completed → in_progress) : completed_at repasse à
-- NULL, stats dématérialisées, user_stats recalculées (ici : supprimées,
-- ces joueurs n'ont aucun autre tournoi terminé).
-- ----------------------------------------------------------------------------

set local role authenticated;

select pg_temp.assert_row_count(
  $sql$ update public.tournaments set status = 'in_progress'
         where id = 'f1000000-0000-4000-8000-000000000001' $sql$,
  1, 'cas 4: réouverture vers in_progress');

reset role;

select pg_temp.assert_eq_int(
  (select count(*) from public.tournaments
    where id = 'f1000000-0000-4000-8000-000000000001' and completed_at is null),
  1, 'cas 4: completed_at repassé à NULL');

select pg_temp.assert_eq_int(
  (select count(*) from public.user_tournament_results
    where tournament_id = 'f1000000-0000-4000-8000-000000000001'),
  0, 'cas 4: user_tournament_results vidés');

select pg_temp.assert_eq_int(
  (select count(*) from public.user_stats
    where user_id in ('d0000000-0000-4000-8000-000000000001',
                      'd0000000-0000-4000-8000-000000000002')),
  0, 'cas 4: user_stats recalculées (supprimées, aucun autre tournoi)');

-- ----------------------------------------------------------------------------
-- Cas 5 — correction du score puis re-complétion : stats re-matérialisées,
-- cohérentes avec les NOUVEAUX scores (7 → 9 points pour Bravo).
-- ----------------------------------------------------------------------------

set local role authenticated;

select pg_temp.assert_row_count(
  $sql$ update public.tournament_matches set score_b = 9
         where tournament_id = 'f1000000-0000-4000-8000-000000000001' $sql$,
  1, 'cas 5: correction du score permise après réouverture');

select pg_temp.assert_row_count(
  $sql$ update public.tournaments set status = 'completed'
         where id = 'f1000000-0000-4000-8000-000000000001' $sql$,
  1, 'cas 5: re-complétion');

reset role;

select pg_temp.assert_eq_int(
  (select count(*) from public.user_tournament_results
    where tournament_id = 'f1000000-0000-4000-8000-000000000001'),
  2, 'cas 5: résultats re-matérialisés');

-- Owner (équipe Alpha, vainqueur) : le différentiel reflète le score corrigé.
select pg_temp.assert_eq_int(
  (select points_conceded from public.user_tournament_results
    where tournament_id = 'f1000000-0000-4000-8000-000000000001'
      and user_id = 'd0000000-0000-4000-8000-000000000001'
      and final_rank = 1 and is_winner),
  9, 'cas 5: points encaissés du vainqueur = nouveau score (9)');

select pg_temp.assert_eq_int(
  (select points_scored from public.user_tournament_results
    where tournament_id = 'f1000000-0000-4000-8000-000000000001'
      and user_id = 'd0000000-0000-4000-8000-000000000002'
      and final_rank = 2),
  9, 'cas 5: points marqués du perdant = nouveau score (9)');

select pg_temp.assert_eq_int(
  (select points_conceded from public.user_stats
    where user_id = 'd0000000-0000-4000-8000-000000000001'
      and tournaments_won = 1 and matches_played = 1),
  9, 'cas 5: user_stats recalculées sur le score corrigé');

select pg_temp.assert_eq_int(
  (select count(*) from public.tournaments
    where id = 'f1000000-0000-4000-8000-000000000001'
      and completed_at is not null),
  1, 'cas 5: completed_at reposé (frais)');

-- ----------------------------------------------------------------------------
-- Cas 6 — non-régression sur un tournoi in_progress : scores et équipes
-- restent modifiables comme avant.
-- ----------------------------------------------------------------------------

set local role authenticated;

select pg_temp.assert_row_count(
  $sql$ update public.tournament_matches
           set score_a = 13, score_b = 5, status = 'completed',
               winner_id = 'a1111111-1111-4111-8111-000000000002'
         where tournament_id = 'f1000000-0000-4000-8000-000000000002' $sql$,
  1, 'cas 6a: saisie de score sur in_progress inchangée');

reset role;

-- RPC équipe sur in_progress : passe (retourne l'id, aucune exception).
select pg_temp.assert_eq_int(
  (select count(*) from (
    select public.update_team_with_players(
      'a1111111-1111-4111-8111-000000000002', 'Alpha bis',
      '[{"user_id": null, "display_name": "Libre"}]'::jsonb)
  ) as rpc_result),
  1, 'cas 6b: update_team_with_players sur in_progress inchangée');

-- ----------------------------------------------------------------------------
-- Récapitulatif lisible avant rollback.
-- ----------------------------------------------------------------------------

select t.name,
       t.status,
       t.visibility,
       t.completed_at is not null as has_completed_at,
       coalesce(r.results_count, 0) as results_count
  from public.tournaments t
  left join (
    select tournament_id, count(*) as results_count
      from public.user_tournament_results
     group by tournament_id
  ) r on r.tournament_id = t.id
 where t.name like 'freeze-check-%'
 order by t.name;

rollback;
