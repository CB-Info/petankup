-- ============================================================================
-- start_tournament_check.sql — vérification manuelle de start_tournament
-- (migration 20260912120000_start_tournament, lot DB-1).
--
-- HORS CI : pas d'infra DB de test dans ce projet. À exécuter à la main dans
-- le SQL Editor de Supabase Studio (ou psql sur la stack locale). Tout est
-- encadré par begin/rollback : aucune ligne ne reste en base. Si une
-- assertion échoue, un raise exception interrompt le script — la
-- transaction avortée annule tout de toute façon.
--
-- Simulation d'identité :
--   - request.jwt.claims (set_config transaction-local) alimente auth.uid()
--     dans les RPC SECURITY DEFINER.
--   - set local role authenticated / reset role éprouve les DROITS réels :
--     l'enveloppe publique et la fonction privée sous le rôle de
--     l'application (cas 0, 1, 4), le refus d'anon (cas 2h), et la
--     fermeture du chemin direct (cas 5).
--
-- Statut d'abord : depuis DB-2 (20260925120000_match_lifecycle_guard), la
-- base elle-même refuse tout match sur un brouillon. Une fonction qui
-- insérerait les matchs AVANT de passer le tournoi en cours échouerait au
-- cas 1 — l'ordre des deux écritures est observable sans sonde.
--
-- Sémantique attendue :
--   - refus de la RPC   → raise exception '<code>' (P0001), message = le code
--   - lot invalide      → 'invalid_matches', et RIEN n'a été écrit
--   - lot incomplet     → 'incomplete_matches' (DB-2), et RIEN n'a été écrit
--   - 'matches_already_generated' n'est plus observable depuis DB-2 (un
--     brouillon n'a jamais de match) : garde de la RPC conservée en défense
--   - tout ou rien      → un lot dont le DERNIER élément est invalide laisse
--                         zéro match ET le statut draft (écriture 1 annulée)
--   - anon              → 42501 (EXECUTE révoqué)
--   - chemin direct     → INSERT direct d'un match : 42501 (privilège révoqué
--                         par DB-2) ; en postgres, P0001 'tournament_not_started'
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- Parité d'environnement : sur le projet hébergé, authenticated a les
-- privilèges DML sur les tables applicatives — ces GRANT y sont des no-ops.
-- Une stack locale peut ne pas les poser : posés ici, DANS la transaction
-- (annulés par le rollback final). VOLONTAIREMENT pas d'insert sur
-- tournament_matches : DB-2 l'a révoqué, le reposer ici testerait un état
-- qui n'existe plus.
-- ----------------------------------------------------------------------------

grant select, insert, update, delete
  on public.tournaments, public.teams,
     public.team_players, public.tournament_members, public.profiles
  to authenticated;
grant select, update, delete on public.tournament_matches to authenticated;

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

create function pg_temp.assert_eq_text(
  p_actual text,
  p_expected text,
  p_label text
) returns void
language plpgsql
as $$
begin
  if p_actual is distinct from p_expected then
    raise exception '[%] attendu « % », obtenu « % »', p_label, p_expected, p_actual;
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

-- Exécute un UPDATE/DELETE/INSERT et vérifie le nombre de lignes affectées.
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

-- Un tournoi doit être resté tel quel : statut attendu, nombre de matchs attendu.
create function pg_temp.assert_state(
  p_tournament_id uuid,
  p_status text,
  p_match_count bigint,
  p_label text
) returns void
language plpgsql
as $$
begin
  perform pg_temp.assert_eq_text(
    (select status::text from public.tournaments where id = p_tournament_id),
    p_status, p_label || ' : statut');
  perform pg_temp.assert_eq_int(
    (select count(*) from public.tournament_matches where tournament_id = p_tournament_id),
    p_match_count, p_label || ' : matchs');
end;
$$;

-- Un brouillon doit être resté intact : statut draft, zéro match.
create function pg_temp.assert_untouched_draft(
  p_tournament_id uuid,
  p_label text
) returns void
language plpgsql
as $$
begin
  perform pg_temp.assert_state(p_tournament_id, 'draft', 0, p_label);
end;
$$;

-- ----------------------------------------------------------------------------
-- Fixtures (en postgres, owner des tables : bypass RLS). Le trigger
-- handle_new_user_profile crée les profiles.
--   S1 : brouillon, 3 équipes                      → nominal
--   S2 : brouillon, 1 équipe                       → not_enough_teams
--   S3 : inséré en cours, 2 équipes, 1 match       → tournament_not_draft
--   S4 : inséré en cours puis terminé, 1 match     → tournament_not_draft
--   S6 : brouillon sain, 2 équipes                 → lots invalides, tout ou rien
--   S7 : brouillon sain, 2 équipes                 → chemin direct fermé
-- Aucune fixture n'insère de match sur un brouillon : depuis DB-2, la base
-- l'interdit (S3 et S4 naissent en cours).
-- ----------------------------------------------------------------------------

insert into auth.users (id, email, aud, role, created_at, updated_at) values
  ('e0000000-0000-4000-8000-000000000001', 'start-owner@petankup.test', 'authenticated', 'authenticated', now(), now()),
  ('e0000000-0000-4000-8000-000000000002', 'start-other@petankup.test', 'authenticated', 'authenticated', now(), now());

insert into public.tournaments (id, owner_id, name, date, status) values
  ('f2000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'start-check-nominal',    current_date, 'draft'),
  ('f2000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'start-check-une-equipe', current_date, 'draft'),
  ('f2000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000001', 'start-check-en-cours',   current_date, 'in_progress'),
  ('f2000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000001', 'start-check-termine',    current_date, 'in_progress'),
  ('f2000000-0000-4000-8000-000000000006', 'e0000000-0000-4000-8000-000000000001', 'start-check-sain',       current_date, 'draft'),
  ('f2000000-0000-4000-8000-000000000007', 'e0000000-0000-4000-8000-000000000001', 'start-check-direct',     current_date, 'draft');

-- Équipes : préfixe a/b/c = équipe, suffixe = tournoi.
insert into public.teams (id, tournament_id, name) values
  ('a2000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'Alpha'),
  ('b2000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'Bravo'),
  ('c2000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'Charlie'),
  ('a2000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000002', 'Alpha'),
  ('a2000000-0000-4000-8000-000000000003', 'f2000000-0000-4000-8000-000000000003', 'Alpha'),
  ('b2000000-0000-4000-8000-000000000003', 'f2000000-0000-4000-8000-000000000003', 'Bravo'),
  ('a2000000-0000-4000-8000-000000000004', 'f2000000-0000-4000-8000-000000000004', 'Alpha'),
  ('b2000000-0000-4000-8000-000000000004', 'f2000000-0000-4000-8000-000000000004', 'Bravo'),
  ('a2000000-0000-4000-8000-000000000006', 'f2000000-0000-4000-8000-000000000006', 'Alpha'),
  ('b2000000-0000-4000-8000-000000000006', 'f2000000-0000-4000-8000-000000000006', 'Bravo'),
  ('a2000000-0000-4000-8000-000000000007', 'f2000000-0000-4000-8000-000000000007', 'Alpha'),
  ('b2000000-0000-4000-8000-000000000007', 'f2000000-0000-4000-8000-000000000007', 'Bravo');

-- S4 : joueurs liés pour que la complétion matérialise sans surprise.
insert into public.team_players (team_id, tournament_id, user_id, display_name) values
  ('a2000000-0000-4000-8000-000000000004', 'f2000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000001', 'start-owner'),
  ('b2000000-0000-4000-8000-000000000004', 'f2000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000002', 'start-other');

-- S3 : un match en attente ; S4 : un match complété (tous deux en cours).
insert into public.tournament_matches (tournament_id, team_a_id, team_b_id, score_a, score_b, winner_id, status, round_number) values
  ('f2000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-000000000003', null, null, null, 'pending', 1),
  ('f2000000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000004', 'b2000000-0000-4000-8000-000000000004', 13, 7, 'a2000000-0000-4000-8000-000000000004', 'completed', 1);

-- S4 : complétion (matérialisation réelle).
update public.tournaments set status = 'completed'
 where id = 'f2000000-0000-4000-8000-000000000004';

-- Identité simulée = owner, pour auth.uid() (RPC) et la RLS (role authenticated).
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'e0000000-0000-4000-8000-000000000001',
                    'role', 'authenticated')::text,
  true);

-- ----------------------------------------------------------------------------
-- Cas 0 — lot incomplet (DB-2), sous le rôle de l'application : brouillon à
-- 3 équipes, lot de 2 matchs sur 3 paires → refus typé, rien écrit.
-- ----------------------------------------------------------------------------

set local role authenticated;

select pg_temp.assert_blocked(
  $sql$ select public.start_tournament('f2000000-0000-4000-8000-000000000001',
          '[{"id": "de000000-0000-4000-8000-000000000011", "team_a_id": "a2000000-0000-4000-8000-000000000001", "team_b_id": "b2000000-0000-4000-8000-000000000001", "round_number": 1},
            {"id": "de000000-0000-4000-8000-000000000012", "team_a_id": "c2000000-0000-4000-8000-000000000001", "team_b_id": "a2000000-0000-4000-8000-000000000001", "round_number": 2}]'::jsonb) $sql$,
  'P0001', 'incomplete_matches', 'cas 0: lot incomplet');

reset role;

select pg_temp.assert_untouched_draft('f2000000-0000-4000-8000-000000000001', 'cas 0');

-- ----------------------------------------------------------------------------
-- Cas 1 — nominal, sous le rôle de l'application : brouillon à 3 équipes,
-- lot de 3 matchs → en cours, 3 matchs fidèles au lot. La garde de DB-2
-- (aucun match sur un brouillon) prouve au passage que le statut est écrit
-- AVANT les matchs.
-- ----------------------------------------------------------------------------

set local role authenticated;

select public.start_tournament(
  'f2000000-0000-4000-8000-000000000001',
  '[
    {"id": "de000000-0000-4000-8000-000000000011", "team_a_id": "a2000000-0000-4000-8000-000000000001", "team_b_id": "b2000000-0000-4000-8000-000000000001", "round_number": 1},
    {"id": "de000000-0000-4000-8000-000000000012", "team_a_id": "c2000000-0000-4000-8000-000000000001", "team_b_id": "a2000000-0000-4000-8000-000000000001", "round_number": 2},
    {"id": "de000000-0000-4000-8000-000000000013", "team_a_id": "b2000000-0000-4000-8000-000000000001", "team_b_id": "c2000000-0000-4000-8000-000000000001", "round_number": 3}
  ]'::jsonb);

reset role;

select pg_temp.assert_state('f2000000-0000-4000-8000-000000000001', 'in_progress', 3, 'cas 1');

-- Fidélité au lot : chaque match a son id, ses équipes dans cet ordre et sa
-- manche ; en attente, sans score ni vainqueur.
select pg_temp.assert_eq_int(
  (select count(*) from public.tournament_matches
    where tournament_id = 'f2000000-0000-4000-8000-000000000001'
      and status = 'pending'
      and score_a is null and score_b is null and winner_id is null
      and (id, team_a_id, team_b_id, round_number) in (
        ('de000000-0000-4000-8000-000000000011'::uuid, 'a2000000-0000-4000-8000-000000000001'::uuid, 'b2000000-0000-4000-8000-000000000001'::uuid, 1),
        ('de000000-0000-4000-8000-000000000012'::uuid, 'c2000000-0000-4000-8000-000000000001'::uuid, 'a2000000-0000-4000-8000-000000000001'::uuid, 2),
        ('de000000-0000-4000-8000-000000000013'::uuid, 'b2000000-0000-4000-8000-000000000001'::uuid, 'c2000000-0000-4000-8000-000000000001'::uuid, 3))),
  3, 'cas 1: matchs fidèles au lot');

-- ----------------------------------------------------------------------------
-- Cas 2 — refus typés, chacun sans aucune écriture. (En postgres : l'enveloppe
-- INVOKER délègue à la DEFINER, auth.uid() lit les claims posés ci-dessus.)
-- ----------------------------------------------------------------------------

-- 2a : tournoi déjà en cours.
select pg_temp.assert_blocked(
  $sql$ select public.start_tournament('f2000000-0000-4000-8000-000000000003',
          '[{"id": "de000000-0000-4000-8000-000000000031", "team_a_id": "a2000000-0000-4000-8000-000000000003", "team_b_id": "b2000000-0000-4000-8000-000000000003", "round_number": 1}]'::jsonb) $sql$,
  'P0001', 'tournament_not_draft', 'cas 2a: tournoi en cours');
select pg_temp.assert_state('f2000000-0000-4000-8000-000000000003', 'in_progress', 1, 'cas 2a');

-- 2b : tournoi terminé.
select pg_temp.assert_blocked(
  $sql$ select public.start_tournament('f2000000-0000-4000-8000-000000000004',
          '[{"id": "de000000-0000-4000-8000-000000000041", "team_a_id": "a2000000-0000-4000-8000-000000000004", "team_b_id": "b2000000-0000-4000-8000-000000000004", "round_number": 1}]'::jsonb) $sql$,
  'P0001', 'tournament_not_draft', 'cas 2b: tournoi terminé');
select pg_temp.assert_state('f2000000-0000-4000-8000-000000000004', 'completed', 1, 'cas 2b');

-- 2c : une seule équipe.
select pg_temp.assert_blocked(
  $sql$ select public.start_tournament('f2000000-0000-4000-8000-000000000002', '[]'::jsonb) $sql$,
  'P0001', 'not_enough_teams', 'cas 2c: une seule équipe');
select pg_temp.assert_untouched_draft('f2000000-0000-4000-8000-000000000002', 'cas 2c');

-- (Pas de cas 2d : « brouillon avec des matchs » est un état impossible
-- depuis DB-2 — la garde matches_already_generated de la RPC reste, en
-- défense en profondeur, mais n'est plus observable.)

-- 2e : tournoi inexistant → not_owner (anti-fuite).
select pg_temp.assert_blocked(
  $sql$ select public.start_tournament('f2000000-0000-4000-8000-0000000000ff', '[]'::jsonb) $sql$,
  'P0001', 'not_owner', 'cas 2e: tournoi inexistant');

-- 2f : autre identité → not_owner, avant tout gate de statut.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'e0000000-0000-4000-8000-000000000002',
                    'role', 'authenticated')::text,
  true);
select pg_temp.assert_blocked(
  $sql$ select public.start_tournament('f2000000-0000-4000-8000-000000000006',
          '[{"id": "de000000-0000-4000-8000-000000000061", "team_a_id": "a2000000-0000-4000-8000-000000000006", "team_b_id": "b2000000-0000-4000-8000-000000000006", "round_number": 1}]'::jsonb) $sql$,
  'P0001', 'not_owner', 'cas 2f: non-propriétaire');
select pg_temp.assert_untouched_draft('f2000000-0000-4000-8000-000000000006', 'cas 2f');

-- 2g : non authentifié (claims sans sub).
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
select pg_temp.assert_blocked(
  $sql$ select public.start_tournament('f2000000-0000-4000-8000-000000000006', '[]'::jsonb) $sql$,
  'P0001', 'not_authenticated', 'cas 2g: non authentifié');
select pg_temp.assert_untouched_draft('f2000000-0000-4000-8000-000000000006', 'cas 2g');

-- Retour à l'identité owner.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'e0000000-0000-4000-8000-000000000001',
                    'role', 'authenticated')::text,
  true);

-- 2h : le rôle anon n'a pas EXECUTE sur l'enveloppe (révoqué) → 42501.
set local role anon;
select pg_temp.assert_blocked(
  $sql$ select public.start_tournament('f2000000-0000-4000-8000-000000000006', '[]'::jsonb) $sql$,
  '42501', null, 'cas 2h: anon sans EXECUTE');
reset role;

-- ----------------------------------------------------------------------------
-- Cas 3 — lots invalides sur un brouillon sain (S6) : refus typé, rien écrit.
-- ----------------------------------------------------------------------------

select pg_temp.assert_blocked(
  $sql$ select public.start_tournament('f2000000-0000-4000-8000-000000000006', '{"id": "x"}'::jsonb) $sql$,
  'P0001', 'invalid_matches', 'cas 3a: pas un tableau');
select pg_temp.assert_untouched_draft('f2000000-0000-4000-8000-000000000006', 'cas 3a');

select pg_temp.assert_blocked(
  $sql$ select public.start_tournament('f2000000-0000-4000-8000-000000000006', '[]'::jsonb) $sql$,
  'P0001', 'invalid_matches', 'cas 3b: tableau vide');
select pg_temp.assert_untouched_draft('f2000000-0000-4000-8000-000000000006', 'cas 3b');

select pg_temp.assert_blocked(
  $sql$ select public.start_tournament('f2000000-0000-4000-8000-000000000006',
          '[{"id": "de000000-0000-4000-8000-000000000061", "team_a_id": "a2000000-0000-4000-8000-000000000006", "round_number": 1}]'::jsonb) $sql$,
  'P0001', 'invalid_matches', 'cas 3c: team_b_id absent');
select pg_temp.assert_untouched_draft('f2000000-0000-4000-8000-000000000006', 'cas 3c');

select pg_temp.assert_blocked(
  $sql$ select public.start_tournament('f2000000-0000-4000-8000-000000000006',
          '[{"id": "pas-un-uuid", "team_a_id": "a2000000-0000-4000-8000-000000000006", "team_b_id": "b2000000-0000-4000-8000-000000000006", "round_number": 1}]'::jsonb) $sql$,
  'P0001', 'invalid_matches', 'cas 3d: uuid mal formé');
select pg_temp.assert_untouched_draft('f2000000-0000-4000-8000-000000000006', 'cas 3d');

select pg_temp.assert_blocked(
  $sql$ select public.start_tournament('f2000000-0000-4000-8000-000000000006',
          '[{"id": "de000000-0000-4000-8000-000000000061", "team_a_id": "a2000000-0000-4000-8000-000000000006", "team_b_id": "a2000000-0000-4000-8000-000000000006", "round_number": 1}]'::jsonb) $sql$,
  'P0001', 'invalid_matches', 'cas 3e: équipe contre elle-même');
select pg_temp.assert_untouched_draft('f2000000-0000-4000-8000-000000000006', 'cas 3e');

select pg_temp.assert_blocked(
  $sql$ select public.start_tournament('f2000000-0000-4000-8000-000000000006',
          '[{"id": "de000000-0000-4000-8000-000000000061", "team_a_id": "a2000000-0000-4000-8000-000000000006", "team_b_id": "b2000000-0000-4000-8000-000000000006", "round_number": 0}]'::jsonb) $sql$,
  'P0001', 'invalid_matches', 'cas 3f: manche 0');
select pg_temp.assert_untouched_draft('f2000000-0000-4000-8000-000000000006', 'cas 3f');

select pg_temp.assert_blocked(
  $sql$ select public.start_tournament('f2000000-0000-4000-8000-000000000006',
          '[{"id": "de000000-0000-4000-8000-000000000061", "team_a_id": "a2000000-0000-4000-8000-000000000006", "team_b_id": "a2000000-0000-4000-8000-000000000001", "round_number": 1}]'::jsonb) $sql$,
  'P0001', 'invalid_matches', 'cas 3g: équipe d''un autre tournoi');
select pg_temp.assert_untouched_draft('f2000000-0000-4000-8000-000000000006', 'cas 3g');

select pg_temp.assert_blocked(
  $sql$ select public.start_tournament('f2000000-0000-4000-8000-000000000006',
          '[{"id": "de000000-0000-4000-8000-000000000061", "team_a_id": "a2000000-0000-4000-8000-000000000006", "team_b_id": "b2000000-0000-4000-8000-000000000006", "round_number": 1},
            {"id": "de000000-0000-4000-8000-000000000062", "team_a_id": "b2000000-0000-4000-8000-000000000006", "team_b_id": "a2000000-0000-4000-8000-000000000006", "round_number": 2}]'::jsonb) $sql$,
  'P0001', 'invalid_matches', 'cas 3h: paire en double (ordre inversé)');
select pg_temp.assert_untouched_draft('f2000000-0000-4000-8000-000000000006', 'cas 3h');

select pg_temp.assert_blocked(
  $sql$ select public.start_tournament('f2000000-0000-4000-8000-000000000006', '[1]'::jsonb) $sql$,
  'P0001', 'invalid_matches', 'cas 3i: élément qui n''est pas un objet');
select pg_temp.assert_untouched_draft('f2000000-0000-4000-8000-000000000006', 'cas 3i');

select pg_temp.assert_blocked(
  $sql$ select public.start_tournament('f2000000-0000-4000-8000-000000000006',
          '[{"id": "de000000-0000-4000-8000-000000000061", "team_a_id": "a2000000-0000-4000-8000-000000000006", "team_b_id": "b2000000-0000-4000-8000-000000000006", "round_number": "abc"}]'::jsonb) $sql$,
  'P0001', 'invalid_matches', 'cas 3j: manche non numérique');
select pg_temp.assert_untouched_draft('f2000000-0000-4000-8000-000000000006', 'cas 3j');

select pg_temp.assert_blocked(
  $sql$ select public.start_tournament('f2000000-0000-4000-8000-000000000006',
          '[{"id": "de000000-0000-4000-8000-000000000061", "team_a_id": "a2000000-0000-4000-8000-000000000006", "team_b_id": "b2000000-0000-4000-8000-000000000006", "round_number": 1.5}]'::jsonb) $sql$,
  'P0001', 'invalid_matches', 'cas 3k: manche non entière');
select pg_temp.assert_untouched_draft('f2000000-0000-4000-8000-000000000006', 'cas 3k');

-- ----------------------------------------------------------------------------
-- Cas 4 — TOUT OU RIEN, sous le rôle de l'application : lot dont le DERNIER
-- élément est invalide (équipe d'un autre tournoi). Attendu : refus typé,
-- zéro match, et le statut toujours draft — l'écriture 1 (statut) a été
-- annulée avec l'écriture 2. Le premier élément est valide : c'est lui qui
-- démarre S6 juste après.
-- ----------------------------------------------------------------------------

set local role authenticated;

select pg_temp.assert_blocked(
  $sql$ select public.start_tournament('f2000000-0000-4000-8000-000000000006',
          '[{"id": "de000000-0000-4000-8000-000000000061", "team_a_id": "a2000000-0000-4000-8000-000000000006", "team_b_id": "b2000000-0000-4000-8000-000000000006", "round_number": 1},
            {"id": "de000000-0000-4000-8000-000000000062", "team_a_id": "a2000000-0000-4000-8000-000000000006", "team_b_id": "b2000000-0000-4000-8000-000000000001", "round_number": 2}]'::jsonb) $sql$,
  'P0001', 'invalid_matches', 'cas 4: dernier match invalide');

reset role;

select pg_temp.assert_untouched_draft('f2000000-0000-4000-8000-000000000006', 'cas 4: tout ou rien');

-- Et après ces refus, le brouillon sain démarre normalement (rôle application).
set local role authenticated;

select public.start_tournament(
  'f2000000-0000-4000-8000-000000000006',
  '[{"id": "de000000-0000-4000-8000-000000000061", "team_a_id": "a2000000-0000-4000-8000-000000000006", "team_b_id": "b2000000-0000-4000-8000-000000000006", "round_number": 1}]'::jsonb);

reset role;

select pg_temp.assert_state('f2000000-0000-4000-8000-000000000006', 'in_progress', 1, 'cas 4: démarre après les refus');
select pg_temp.assert_eq_int(
  (select count(*) from public.tournament_matches
    where tournament_id = 'f2000000-0000-4000-8000-000000000006'
      and (id, team_a_id, team_b_id, round_number) = (
        'de000000-0000-4000-8000-000000000061'::uuid,
        'a2000000-0000-4000-8000-000000000006'::uuid,
        'b2000000-0000-4000-8000-000000000006'::uuid, 1)),
  1, 'cas 4: le match est fidèle au lot');

-- ----------------------------------------------------------------------------
-- Cas 5 — le chemin direct est fermé (DB-2) : la RPC est la seule voie
-- d'entrée d'un match. Le statut, lui, reste modifiable en direct.
-- ----------------------------------------------------------------------------

-- 5a : owner, INSERT direct sur un brouillon → 42501 (privilège révoqué).
set local role authenticated;
select pg_temp.assert_blocked(
  $sql$ insert into public.tournament_matches (tournament_id, team_a_id, team_b_id, status, round_number)
        values ('f2000000-0000-4000-8000-000000000007',
                'a2000000-0000-4000-8000-000000000007',
                'b2000000-0000-4000-8000-000000000007',
                'pending', 1) $sql$,
  '42501', null, 'cas 5a: INSERT direct sur un brouillon (owner)');
reset role;

-- 5b : même INSERT en postgres (hors privilèges) → la garde répond.
select pg_temp.assert_blocked(
  $sql$ insert into public.tournament_matches (tournament_id, team_a_id, team_b_id, status, round_number)
        values ('f2000000-0000-4000-8000-000000000007',
                'a2000000-0000-4000-8000-000000000007',
                'b2000000-0000-4000-8000-000000000007',
                'pending', 1) $sql$,
  'P0001', 'tournament_not_started', 'cas 5b: INSERT direct sur un brouillon (postgres)');
select pg_temp.assert_untouched_draft('f2000000-0000-4000-8000-000000000007', 'cas 5a/5b');

-- 5c : owner, UPDATE direct du statut → passe toujours (hors périmètre de
-- DB-2 : un tournoi en cours sans match n'est pas un match sur un brouillon).
set local role authenticated;
select pg_temp.assert_row_count(
  $sql$ update public.tournaments set status = 'in_progress'
         where id = 'f2000000-0000-4000-8000-000000000007' $sql$,
  1, 'cas 5c: UPDATE direct du statut');
reset role;

-- 5d : la RPC refuse un tournoi déjà lancé.
select pg_temp.assert_blocked(
  $sql$ select public.start_tournament('f2000000-0000-4000-8000-000000000007',
          '[{"id": "de000000-0000-4000-8000-000000000071", "team_a_id": "a2000000-0000-4000-8000-000000000007", "team_b_id": "b2000000-0000-4000-8000-000000000007", "round_number": 1}]'::jsonb) $sql$,
  'P0001', 'tournament_not_draft', 'cas 5d: RPC après le passage en cours');

-- 5e : owner, INSERT direct sur un tournoi en cours → 42501 aussi : le
-- privilège répond avant toute règle de ligne.
set local role authenticated;
select pg_temp.assert_blocked(
  $sql$ insert into public.tournament_matches (tournament_id, team_a_id, team_b_id, status, round_number)
        values ('f2000000-0000-4000-8000-000000000007',
                'a2000000-0000-4000-8000-000000000007',
                'b2000000-0000-4000-8000-000000000007',
                'pending', 1) $sql$,
  '42501', null, 'cas 5e: INSERT direct sur un tournoi en cours (owner)');
reset role;
select pg_temp.assert_state('f2000000-0000-4000-8000-000000000007', 'in_progress', 0, 'cas 5e');

-- ----------------------------------------------------------------------------
-- Récapitulatif lisible avant rollback.
-- ----------------------------------------------------------------------------

select t.name,
       t.status,
       (select count(*) from public.tournament_matches m where m.tournament_id = t.id) as match_count
  from public.tournaments t
 where t.name like 'start-check-%'
 order by t.name;

rollback;
