-- ============================================================================
-- ranking_fixtures_check.sql — vérification MANUELLE du ranking SQL.
--
-- Pendant côté base de données des fixtures partagées
-- tests/fixtures/ranking-vectors.ts. Rejoue les MÊMES vecteurs à travers le
-- vrai chemin de production (passage d'un tournoi à `completed` → trigger
-- private.on_tournament_completed → private.materialize_tournament_results)
-- et asserte que user_tournament_results.final_rank == expectedRanksSQL.
--
-- HORS CI : pas d'infra DB de test dans ce projet. À lancer à la main dans
-- le SQL Editor de Supabase Studio. Le script est autonome et copiable d'un
-- bloc. Il est encadré par BEGIN ... ROLLBACK : il NE LAISSE AUCUNE LIGNE en
-- base (ni tournoi, ni user, ni stats). Si un rang ne matche pas, un
-- `raise exception` lisible interrompt tout avant le ROLLBACK.
--
-- ⚠ Synchro manuelle avec tests/fixtures/ranking-vectors.ts : PAS de
-- génération croisée. Si tu modifies un vecteur ici, répercute-le dans la
-- fixture TS (et inversement), sinon le test TS et ce script divergent en
-- silence.
--
-- ----------------------------------------------------------------------------
-- Table des vecteurs (copie humaine de référence — voir la fixture TS pour
-- l'analyse complète de la frontière). Équipes a < b < c < d par team_id.
-- Tous les matchs sont 13-7 (X>Y = X bat Y). expectedRanksSQL ci-dessous ;
-- expectedRanksTS et le verdict converge/diverge vivent côté TS (ce script
-- ne teste QUE le SQL, qui est insensible à l'ordre d'entrée des équipes).
--
--   1. clean-4-team-no-tie                     a>b,a>c,a>d,b>c,b>d,c>d   → a1 b2 c3 d4
--   2. 4-team-two-tied-pairs                    a>c,a>b,d>a,c>b,c>d,b>d   → a1 c2 b3 d4
--   3. perfect-3-cycle-entry-equals-id-order    a>b,b>c,c>a               → a1 b2 c3
--   4. perfect-3-cycle-entry-c-a-b              a>b,b>c,c>a               → a1 b2 c3
--   5. perfect-3-cycle-entry-b-c-a              a>b,b>c,c>a               → a1 b2 c3
--   6. 4-team-3way-cycle-top-entry-reversed     a>b,b>c,c>a,a>d,b>d,c>d   → a1 b2 c3 d4
--
-- NB : les vecteurs 3, 4 et 5 partagent EXACTEMENT les mêmes matchs (le même
-- cycle parfait a>b>c>a). Leur divergence est purement côté TS (ordre
-- d'entrée des équipes), une notion qui n'existe pas en SQL. Le SQL départage
-- par team_id → a1 b2 c3 pour les trois. On les garde séparés pour rester en
-- correspondance 1:1 avec la fixture TS.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- Fonction d'assertion (temporaire, jetée en fin de session / ROLLBACK).
-- Lit le final_rank matérialisé d'une équipe et le compare à l'attendu.
-- raise exception lisible si absent ou différent.
-- ----------------------------------------------------------------------------
create function pg_temp.assert_rank(
  p_tournament uuid,
  p_team uuid,
  p_expected int,
  p_label text
) returns void
language plpgsql
as $$
declare
  v_rank int;
begin
  select final_rank into v_rank
    from public.user_tournament_results
   where tournament_id = p_tournament
     and team_id = p_team
   limit 1;

  if v_rank is null then
    raise exception '[%] aucune ligne user_tournament_results pour team % (tournoi %)',
      p_label, p_team, p_tournament;
  end if;
  if v_rank <> p_expected then
    raise exception '[%] team % : rang attendu %, obtenu %',
      p_label, p_team, p_expected, v_rank;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4 utilisateurs de test. Le trigger AFTER INSERT handle_new_user_profile
-- crée leur profil automatiquement (avec suffixe anti-collision si besoin).
-- Réutilisés comme joueurs d'une équipe dans chaque tournoi : l'index unique
-- partiel team_players_one_per_user_per_tournament impose un user DISTINCT
-- par équipe au sein d'un même tournoi, mais autorise la réutilisation entre
-- tournois différents.
-- ----------------------------------------------------------------------------
insert into auth.users (id, email, aud, role, created_at, updated_at) values
  ('e0000000-0000-4000-8000-000000000001', 'ranking-fixture-1@petankup.test', 'authenticated', 'authenticated', now(), now()),
  ('e0000000-0000-4000-8000-000000000002', 'ranking-fixture-2@petankup.test', 'authenticated', 'authenticated', now(), now()),
  ('e0000000-0000-4000-8000-000000000003', 'ranking-fixture-3@petankup.test', 'authenticated', 'authenticated', now(), now()),
  ('e0000000-0000-4000-8000-000000000004', 'ranking-fixture-4@petankup.test', 'authenticated', 'authenticated', now(), now());

-- ============================================================================
-- Helper de structure : pour CHAQUE vecteur on insère un tournoi draft, ses
-- équipes (team_id à préfixe-lettre dominant → ordre a<b<c<d intra-tournoi,
-- suffixe = numéro de vecteur pour l'unicité globale du PK), un joueur lié par
-- équipe, et les matchs completed. Puis on passe le tournoi à `completed` pour
-- déclencher la matérialisation réelle, et on asserte les rangs.
--
-- Les UUID d'équipe suivent le motif :
--   <lettre x8>-<lettre x4>-4<lettre x3>-8<lettre x3>-00000000000<vecteur>
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Vecteur 1 — clean-4-team-no-tie → a1 b2 c3 d4
-- ----------------------------------------------------------------------------
insert into public.tournaments (id, owner_id, name, date, status) values
  ('f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'fixture-clean-4-team-no-tie', current_date, 'draft');

insert into public.teams (id, tournament_id, name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001', 'f0000000-0000-4000-8000-000000000001', 'A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000001', 'f0000000-0000-4000-8000-000000000001', 'B'),
  ('cccccccc-cccc-4ccc-8ccc-000000000001', 'f0000000-0000-4000-8000-000000000001', 'C'),
  ('dddddddd-dddd-4ddd-8ddd-000000000001', 'f0000000-0000-4000-8000-000000000001', 'D');

insert into public.team_players (team_id, tournament_id, user_id, display_name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001', 'f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000001', 'f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002', 'B'),
  ('cccccccc-cccc-4ccc-8ccc-000000000001', 'f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000003', 'C'),
  ('dddddddd-dddd-4ddd-8ddd-000000000001', 'f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000004', 'D');

insert into public.matches (tournament_id, team_a_id, team_b_id, score_a, score_b, winner_id, status, round_number) values
  ('f0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001', 13, 7, 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', 'completed', 1),
  ('f0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', 'cccccccc-cccc-4ccc-8ccc-000000000001', 13, 7, 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', 'completed', 2),
  ('f0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', 'dddddddd-dddd-4ddd-8ddd-000000000001', 13, 7, 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', 'completed', 3),
  ('f0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001', 'cccccccc-cccc-4ccc-8ccc-000000000001', 13, 7, 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001', 'completed', 4),
  ('f0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001', 'dddddddd-dddd-4ddd-8ddd-000000000001', 13, 7, 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001', 'completed', 5),
  ('f0000000-0000-4000-8000-000000000001', 'cccccccc-cccc-4ccc-8ccc-000000000001', 'dddddddd-dddd-4ddd-8ddd-000000000001', 13, 7, 'cccccccc-cccc-4ccc-8ccc-000000000001', 'completed', 6);

update public.tournaments set status = 'completed' where id = 'f0000000-0000-4000-8000-000000000001';

select pg_temp.assert_rank('f0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', 1, 'clean-4-team-no-tie');
select pg_temp.assert_rank('f0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001', 2, 'clean-4-team-no-tie');
select pg_temp.assert_rank('f0000000-0000-4000-8000-000000000001', 'cccccccc-cccc-4ccc-8ccc-000000000001', 3, 'clean-4-team-no-tie');
select pg_temp.assert_rank('f0000000-0000-4000-8000-000000000001', 'dddddddd-dddd-4ddd-8ddd-000000000001', 4, 'clean-4-team-no-tie');

-- ----------------------------------------------------------------------------
-- Vecteur 2 — 4-team-two-tied-pairs → a1 c2 b3 d4
-- Matchs : a>c, a>b, d>a, c>b, c>d, b>d
-- ----------------------------------------------------------------------------
insert into public.tournaments (id, owner_id, name, date, status) values
  ('f0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'fixture-4-team-two-tied-pairs', current_date, 'draft');

insert into public.teams (id, tournament_id, name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000002', 'f0000000-0000-4000-8000-000000000002', 'A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000002', 'f0000000-0000-4000-8000-000000000002', 'B'),
  ('cccccccc-cccc-4ccc-8ccc-000000000002', 'f0000000-0000-4000-8000-000000000002', 'C'),
  ('dddddddd-dddd-4ddd-8ddd-000000000002', 'f0000000-0000-4000-8000-000000000002', 'D');

insert into public.team_players (team_id, tournament_id, user_id, display_name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000002', 'f0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000002', 'f0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000002', 'B'),
  ('cccccccc-cccc-4ccc-8ccc-000000000002', 'f0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000003', 'C'),
  ('dddddddd-dddd-4ddd-8ddd-000000000002', 'f0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000004', 'D');

insert into public.matches (tournament_id, team_a_id, team_b_id, score_a, score_b, winner_id, status, round_number) values
  ('f0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002', 'cccccccc-cccc-4ccc-8ccc-000000000002', 13, 7, 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002', 'completed', 1),
  ('f0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002', 13, 7, 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002', 'completed', 2),
  ('f0000000-0000-4000-8000-000000000002', 'dddddddd-dddd-4ddd-8ddd-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002', 13, 7, 'dddddddd-dddd-4ddd-8ddd-000000000002', 'completed', 3),
  ('f0000000-0000-4000-8000-000000000002', 'cccccccc-cccc-4ccc-8ccc-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002', 13, 7, 'cccccccc-cccc-4ccc-8ccc-000000000002', 'completed', 4),
  ('f0000000-0000-4000-8000-000000000002', 'cccccccc-cccc-4ccc-8ccc-000000000002', 'dddddddd-dddd-4ddd-8ddd-000000000002', 13, 7, 'cccccccc-cccc-4ccc-8ccc-000000000002', 'completed', 5),
  ('f0000000-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002', 'dddddddd-dddd-4ddd-8ddd-000000000002', 13, 7, 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002', 'completed', 6);

update public.tournaments set status = 'completed' where id = 'f0000000-0000-4000-8000-000000000002';

select pg_temp.assert_rank('f0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002', 1, '4-team-two-tied-pairs');
select pg_temp.assert_rank('f0000000-0000-4000-8000-000000000002', 'cccccccc-cccc-4ccc-8ccc-000000000002', 2, '4-team-two-tied-pairs');
select pg_temp.assert_rank('f0000000-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002', 3, '4-team-two-tied-pairs');
select pg_temp.assert_rank('f0000000-0000-4000-8000-000000000002', 'dddddddd-dddd-4ddd-8ddd-000000000002', 4, '4-team-two-tied-pairs');

-- ----------------------------------------------------------------------------
-- Vecteur 3 — perfect-3-cycle-entry-equals-id-order → a1 b2 c3
-- Matchs : a>b, b>c, c>a (cycle parfait, scalaires égaux)
-- ----------------------------------------------------------------------------
insert into public.tournaments (id, owner_id, name, date, status) values
  ('f0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000001', 'fixture-perfect-3-cycle-entry-equals-id-order', current_date, 'draft');

insert into public.teams (id, tournament_id, name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000003', 'f0000000-0000-4000-8000-000000000003', 'A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000003', 'f0000000-0000-4000-8000-000000000003', 'B'),
  ('cccccccc-cccc-4ccc-8ccc-000000000003', 'f0000000-0000-4000-8000-000000000003', 'C');

insert into public.team_players (team_id, tournament_id, user_id, display_name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000003', 'f0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000001', 'A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000003', 'f0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000002', 'B'),
  ('cccccccc-cccc-4ccc-8ccc-000000000003', 'f0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000003', 'C');

insert into public.matches (tournament_id, team_a_id, team_b_id, score_a, score_b, winner_id, status, round_number) values
  ('f0000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003', 'bbbbbbbb-bbbb-4bbb-8bbb-000000000003', 13, 7, 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003', 'completed', 1),
  ('f0000000-0000-4000-8000-000000000003', 'bbbbbbbb-bbbb-4bbb-8bbb-000000000003', 'cccccccc-cccc-4ccc-8ccc-000000000003', 13, 7, 'bbbbbbbb-bbbb-4bbb-8bbb-000000000003', 'completed', 2),
  ('f0000000-0000-4000-8000-000000000003', 'cccccccc-cccc-4ccc-8ccc-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003', 13, 7, 'cccccccc-cccc-4ccc-8ccc-000000000003', 'completed', 3);

update public.tournaments set status = 'completed' where id = 'f0000000-0000-4000-8000-000000000003';

select pg_temp.assert_rank('f0000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003', 1, 'perfect-3-cycle-entry-equals-id-order');
select pg_temp.assert_rank('f0000000-0000-4000-8000-000000000003', 'bbbbbbbb-bbbb-4bbb-8bbb-000000000003', 2, 'perfect-3-cycle-entry-equals-id-order');
select pg_temp.assert_rank('f0000000-0000-4000-8000-000000000003', 'cccccccc-cccc-4ccc-8ccc-000000000003', 3, 'perfect-3-cycle-entry-equals-id-order');

-- ----------------------------------------------------------------------------
-- Vecteur 4 — perfect-3-cycle-entry-c-a-b → a1 b2 c3 (SQL identique au vecteur 3)
-- ----------------------------------------------------------------------------
insert into public.tournaments (id, owner_id, name, date, status) values
  ('f0000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000001', 'fixture-perfect-3-cycle-entry-c-a-b', current_date, 'draft');

insert into public.teams (id, tournament_id, name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000004', 'f0000000-0000-4000-8000-000000000004', 'A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000004', 'f0000000-0000-4000-8000-000000000004', 'B'),
  ('cccccccc-cccc-4ccc-8ccc-000000000004', 'f0000000-0000-4000-8000-000000000004', 'C');

insert into public.team_players (team_id, tournament_id, user_id, display_name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000004', 'f0000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000001', 'A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000004', 'f0000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000002', 'B'),
  ('cccccccc-cccc-4ccc-8ccc-000000000004', 'f0000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000003', 'C');

insert into public.matches (tournament_id, team_a_id, team_b_id, score_a, score_b, winner_id, status, round_number) values
  ('f0000000-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000004', 'bbbbbbbb-bbbb-4bbb-8bbb-000000000004', 13, 7, 'aaaaaaaa-aaaa-4aaa-8aaa-000000000004', 'completed', 1),
  ('f0000000-0000-4000-8000-000000000004', 'bbbbbbbb-bbbb-4bbb-8bbb-000000000004', 'cccccccc-cccc-4ccc-8ccc-000000000004', 13, 7, 'bbbbbbbb-bbbb-4bbb-8bbb-000000000004', 'completed', 2),
  ('f0000000-0000-4000-8000-000000000004', 'cccccccc-cccc-4ccc-8ccc-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000004', 13, 7, 'cccccccc-cccc-4ccc-8ccc-000000000004', 'completed', 3);

update public.tournaments set status = 'completed' where id = 'f0000000-0000-4000-8000-000000000004';

select pg_temp.assert_rank('f0000000-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000004', 1, 'perfect-3-cycle-entry-c-a-b');
select pg_temp.assert_rank('f0000000-0000-4000-8000-000000000004', 'bbbbbbbb-bbbb-4bbb-8bbb-000000000004', 2, 'perfect-3-cycle-entry-c-a-b');
select pg_temp.assert_rank('f0000000-0000-4000-8000-000000000004', 'cccccccc-cccc-4ccc-8ccc-000000000004', 3, 'perfect-3-cycle-entry-c-a-b');

-- ----------------------------------------------------------------------------
-- Vecteur 5 — perfect-3-cycle-entry-b-c-a → a1 b2 c3 (SQL identique au vecteur 3)
-- ----------------------------------------------------------------------------
insert into public.tournaments (id, owner_id, name, date, status) values
  ('f0000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-000000000001', 'fixture-perfect-3-cycle-entry-b-c-a', current_date, 'draft');

insert into public.teams (id, tournament_id, name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000005', 'f0000000-0000-4000-8000-000000000005', 'A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000005', 'f0000000-0000-4000-8000-000000000005', 'B'),
  ('cccccccc-cccc-4ccc-8ccc-000000000005', 'f0000000-0000-4000-8000-000000000005', 'C');

insert into public.team_players (team_id, tournament_id, user_id, display_name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000005', 'f0000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-000000000001', 'A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000005', 'f0000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-000000000002', 'B'),
  ('cccccccc-cccc-4ccc-8ccc-000000000005', 'f0000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-000000000003', 'C');

insert into public.matches (tournament_id, team_a_id, team_b_id, score_a, score_b, winner_id, status, round_number) values
  ('f0000000-0000-4000-8000-000000000005', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000005', 'bbbbbbbb-bbbb-4bbb-8bbb-000000000005', 13, 7, 'aaaaaaaa-aaaa-4aaa-8aaa-000000000005', 'completed', 1),
  ('f0000000-0000-4000-8000-000000000005', 'bbbbbbbb-bbbb-4bbb-8bbb-000000000005', 'cccccccc-cccc-4ccc-8ccc-000000000005', 13, 7, 'bbbbbbbb-bbbb-4bbb-8bbb-000000000005', 'completed', 2),
  ('f0000000-0000-4000-8000-000000000005', 'cccccccc-cccc-4ccc-8ccc-000000000005', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000005', 13, 7, 'cccccccc-cccc-4ccc-8ccc-000000000005', 'completed', 3);

update public.tournaments set status = 'completed' where id = 'f0000000-0000-4000-8000-000000000005';

select pg_temp.assert_rank('f0000000-0000-4000-8000-000000000005', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000005', 1, 'perfect-3-cycle-entry-b-c-a');
select pg_temp.assert_rank('f0000000-0000-4000-8000-000000000005', 'bbbbbbbb-bbbb-4bbb-8bbb-000000000005', 2, 'perfect-3-cycle-entry-b-c-a');
select pg_temp.assert_rank('f0000000-0000-4000-8000-000000000005', 'cccccccc-cccc-4ccc-8ccc-000000000005', 3, 'perfect-3-cycle-entry-b-c-a');

-- ----------------------------------------------------------------------------
-- Vecteur 6 — 4-team-3way-cycle-top-entry-reversed → a1 b2 c3 d4
-- Matchs : a>b, b>c, c>a (cycle au sommet) + a>d, b>d, c>d
-- ----------------------------------------------------------------------------
insert into public.tournaments (id, owner_id, name, date, status) values
  ('f0000000-0000-4000-8000-000000000006', 'e0000000-0000-4000-8000-000000000001', 'fixture-4-team-3way-cycle-top-entry-reversed', current_date, 'draft');

insert into public.teams (id, tournament_id, name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000006', 'f0000000-0000-4000-8000-000000000006', 'A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000006', 'f0000000-0000-4000-8000-000000000006', 'B'),
  ('cccccccc-cccc-4ccc-8ccc-000000000006', 'f0000000-0000-4000-8000-000000000006', 'C'),
  ('dddddddd-dddd-4ddd-8ddd-000000000006', 'f0000000-0000-4000-8000-000000000006', 'D');

insert into public.team_players (team_id, tournament_id, user_id, display_name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000006', 'f0000000-0000-4000-8000-000000000006', 'e0000000-0000-4000-8000-000000000001', 'A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000006', 'f0000000-0000-4000-8000-000000000006', 'e0000000-0000-4000-8000-000000000002', 'B'),
  ('cccccccc-cccc-4ccc-8ccc-000000000006', 'f0000000-0000-4000-8000-000000000006', 'e0000000-0000-4000-8000-000000000003', 'C'),
  ('dddddddd-dddd-4ddd-8ddd-000000000006', 'f0000000-0000-4000-8000-000000000006', 'e0000000-0000-4000-8000-000000000004', 'D');

insert into public.matches (tournament_id, team_a_id, team_b_id, score_a, score_b, winner_id, status, round_number) values
  ('f0000000-0000-4000-8000-000000000006', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000006', 'bbbbbbbb-bbbb-4bbb-8bbb-000000000006', 13, 7, 'aaaaaaaa-aaaa-4aaa-8aaa-000000000006', 'completed', 1),
  ('f0000000-0000-4000-8000-000000000006', 'bbbbbbbb-bbbb-4bbb-8bbb-000000000006', 'cccccccc-cccc-4ccc-8ccc-000000000006', 13, 7, 'bbbbbbbb-bbbb-4bbb-8bbb-000000000006', 'completed', 2),
  ('f0000000-0000-4000-8000-000000000006', 'cccccccc-cccc-4ccc-8ccc-000000000006', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000006', 13, 7, 'cccccccc-cccc-4ccc-8ccc-000000000006', 'completed', 3),
  ('f0000000-0000-4000-8000-000000000006', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000006', 'dddddddd-dddd-4ddd-8ddd-000000000006', 13, 7, 'aaaaaaaa-aaaa-4aaa-8aaa-000000000006', 'completed', 4),
  ('f0000000-0000-4000-8000-000000000006', 'bbbbbbbb-bbbb-4bbb-8bbb-000000000006', 'dddddddd-dddd-4ddd-8ddd-000000000006', 13, 7, 'bbbbbbbb-bbbb-4bbb-8bbb-000000000006', 'completed', 5),
  ('f0000000-0000-4000-8000-000000000006', 'cccccccc-cccc-4ccc-8ccc-000000000006', 'dddddddd-dddd-4ddd-8ddd-000000000006', 13, 7, 'cccccccc-cccc-4ccc-8ccc-000000000006', 'completed', 6);

update public.tournaments set status = 'completed' where id = 'f0000000-0000-4000-8000-000000000006';

select pg_temp.assert_rank('f0000000-0000-4000-8000-000000000006', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000006', 1, '4-team-3way-cycle-top-entry-reversed');
select pg_temp.assert_rank('f0000000-0000-4000-8000-000000000006', 'bbbbbbbb-bbbb-4bbb-8bbb-000000000006', 2, '4-team-3way-cycle-top-entry-reversed');
select pg_temp.assert_rank('f0000000-0000-4000-8000-000000000006', 'cccccccc-cccc-4ccc-8ccc-000000000006', 3, '4-team-3way-cycle-top-entry-reversed');
select pg_temp.assert_rank('f0000000-0000-4000-8000-000000000006', 'dddddddd-dddd-4ddd-8ddd-000000000006', 4, '4-team-3way-cycle-top-entry-reversed');

-- ----------------------------------------------------------------------------
-- Récapitulatif lisible (à l'œil) AVANT rollback : tous les rangs matérialisés.
-- Si on arrive ici sans exception, les 6 vecteurs ont passé.
-- ----------------------------------------------------------------------------
select
  t.name as vecteur,
  r.team_id,
  r.final_rank,
  r.wins,
  r.losses,
  r.points_scored,
  r.points_conceded
from public.user_tournament_results r
join public.tournaments t on t.id = r.tournament_id
where t.id in (
  'f0000000-0000-4000-8000-000000000001',
  'f0000000-0000-4000-8000-000000000002',
  'f0000000-0000-4000-8000-000000000003',
  'f0000000-0000-4000-8000-000000000004',
  'f0000000-0000-4000-8000-000000000005',
  'f0000000-0000-4000-8000-000000000006'
)
order by t.name, r.final_rank;

-- Aucun état laissé en base : tout ce qui précède est annulé.
rollback;
