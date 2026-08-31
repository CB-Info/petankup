-- ============================================================================
-- tournament_score_check.sql — vérification manuelle de la règle de score
-- stricte des matchs de tournoi (migration 20260831150000).
--
-- HORS CI : à exécuter à la main dans le SQL Editor de Supabase Studio (ou
-- psql sur la stack locale). Tout est encadré par begin/rollback : aucune
-- ligne ne reste en base. Si une assertion échoue, un raise exception
-- interrompt le script — la transaction avortée annule tout de toute façon.
--
-- Règle éprouvée : pour un match completed, le vainqueur marque EXACTEMENT
-- 13 et le perdant entre 0 et 12 — CHECK tournament_matches_winner_scores_13
-- et tournament_matches_loser_between_0_and_12, miroirs des matchs libres.
--
-- Tout se joue en postgres (INSERT/UPDATE directs, hors RLS — filet de
-- sécurité au niveau des CHECK, motif des cas 6g/6h de free_match_check).
-- Aucun bloc GRANT ni simulation d'identité : la RLS n'est pas le sujet.
-- Le tournoi de fixtures RESTE en draft : aucun trigger de matérialisation
-- ne se déclenche, le harnais n'éprouve que les CHECK de la table des matchs.
--
-- Point de vigilance — CONTRAINTE CITÉE par le 23514 : plusieurs CHECK
-- peuvent être violées simultanément ; Postgres les évalue en ordre
-- ALPHABÉTIQUE de nom et cite la première violée. Sur tournament_matches :
-- completed_score_valid < loser_between_0_and_12 < winner_scores_13.
-- Conséquence : 12-5, 13-13 et un score négatif violaient DÉJÀ la contrainte
-- historique (c'est elle qui répond) ; seul un vainqueur > 13 avec perdant
-- ≤ 12 fait répondre winner_scores_13, et 14-13 est le seul motif qui fait
-- répondre loser_between_0_and_12 tant que la contrainte historique existe.
-- Renommer une CHECK de la table changerait la contrainte citée et casserait
-- ce harnais.
--
-- Cas :
--   1  acceptés : 13-0, 13-12 (vainqueur côté A), 0-13 (côté B — symétrie
--      least/greatest).
--   2  refusés (INSERT direct, 23514, message exact) : 12-5, 13-13, 13 à -1
--      → contrainte historique ; 20-0 et 14-0 (motif réel des données
--      hébergées corrigées) → winner_scores_13 ; 14-13 → loser_between.
--   3  garde par statut : un match pending (scores NULL) passe les
--      nouvelles CHECK.
--   4  l'UPDATE est couvert aussi (vecteur réel de la saisie de score) :
--      13-0 → 20-0 refusé, le match reste 13-0.
-- ============================================================================

begin;

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

-- ----------------------------------------------------------------------------
-- Fixtures (en postgres, owner des tables : bypass RLS). Le tournoi reste en
-- draft. Quatre équipes : l'index unique tournament_matches_unique_pair_per_
-- tournament interdit deux matchs de la même paire — les trois matchs
-- acceptés et le pending consomment quatre paires distinctes ; les INSERT
-- refusés ne persistent rien et réutilisent tous la paire Bravo-Delta.
-- ----------------------------------------------------------------------------

insert into auth.users (id, email, aud, role, created_at, updated_at) values
  ('d1000000-0000-4000-8000-000000000001', 'score-check-owner@petankup.test', 'authenticated', 'authenticated', now(), now());

insert into public.tournaments (id, owner_id, name, date, status) values
  ('f6000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'score-check-T1', current_date, 'draft');

insert into public.teams (id, tournament_id, name) values
  ('a6000000-0000-4000-8000-000000000001', 'f6000000-0000-4000-8000-000000000001', 'Alpha'),
  ('b6000000-0000-4000-8000-000000000001', 'f6000000-0000-4000-8000-000000000001', 'Bravo'),
  ('c6000000-0000-4000-8000-000000000001', 'f6000000-0000-4000-8000-000000000001', 'Charlie'),
  ('d6000000-0000-4000-8000-000000000001', 'f6000000-0000-4000-8000-000000000001', 'Delta');

-- ----------------------------------------------------------------------------
-- Cas 1 — scores acceptés par la règle stricte.
-- ----------------------------------------------------------------------------

insert into public.tournament_matches (id, tournament_id, team_a_id, team_b_id, score_a, score_b, winner_id, status, round_number) values
  -- 1a : 13-0, vainqueur côté A (Alpha-Bravo).
  ('e6000000-0000-4000-8000-000000000001', 'f6000000-0000-4000-8000-000000000001',
   'a6000000-0000-4000-8000-000000000001', 'b6000000-0000-4000-8000-000000000001',
   13, 0, 'a6000000-0000-4000-8000-000000000001', 'completed', 1),
  -- 1b : 13-12, vainqueur côté A (Alpha-Charlie).
  ('e6000000-0000-4000-8000-000000000002', 'f6000000-0000-4000-8000-000000000001',
   'a6000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000001',
   13, 12, 'a6000000-0000-4000-8000-000000000001', 'completed', 2),
  -- 1c : 0-13, vainqueur côté B (Alpha-Delta) — symétrie least/greatest.
  ('e6000000-0000-4000-8000-000000000003', 'f6000000-0000-4000-8000-000000000001',
   'a6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000001',
   0, 13, 'd6000000-0000-4000-8000-000000000001', 'completed', 3);

select pg_temp.assert_eq_int(
  (select count(*) from public.tournament_matches
    where id in ('e6000000-0000-4000-8000-000000000001',
                 'e6000000-0000-4000-8000-000000000002',
                 'e6000000-0000-4000-8000-000000000003')),
  3, 'cas 1d: 13-0, 13-12 et 0-13 acceptés');

-- ----------------------------------------------------------------------------
-- Cas 2 — scores refusés (INSERT direct, paire Bravo-Delta réutilisable :
-- rien ne persiste). La contrainte citée suit l'ordre alphabétique (en-tête).
-- ----------------------------------------------------------------------------

select pg_temp.assert_blocked(
  $sql$ insert into public.tournament_matches
          (tournament_id, team_a_id, team_b_id, score_a, score_b, winner_id, status, round_number)
        values ('f6000000-0000-4000-8000-000000000001',
                'b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000001',
                12, 5, 'b6000000-0000-4000-8000-000000000001', 'completed', 4) $sql$,
  '23514', 'new row for relation "tournament_matches" violates check constraint "tournament_matches_completed_score_valid"',
  'cas 2a: 12-5 refusé — personne n''atteint 13');

select pg_temp.assert_blocked(
  $sql$ insert into public.tournament_matches
          (tournament_id, team_a_id, team_b_id, score_a, score_b, winner_id, status, round_number)
        values ('f6000000-0000-4000-8000-000000000001',
                'b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000001',
                13, 13, 'b6000000-0000-4000-8000-000000000001', 'completed', 4) $sql$,
  '23514', 'new row for relation "tournament_matches" violates check constraint "tournament_matches_completed_score_valid"',
  'cas 2b: 13-13 refusé — pas de match nul');

select pg_temp.assert_blocked(
  $sql$ insert into public.tournament_matches
          (tournament_id, team_a_id, team_b_id, score_a, score_b, winner_id, status, round_number)
        values ('f6000000-0000-4000-8000-000000000001',
                'b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000001',
                20, 0, 'b6000000-0000-4000-8000-000000000001', 'completed', 4) $sql$,
  '23514', 'new row for relation "tournament_matches" violates check constraint "tournament_matches_winner_scores_13"',
  'cas 2c: 20-0 refusé — vainqueur au-delà de 13');

select pg_temp.assert_blocked(
  $sql$ insert into public.tournament_matches
          (tournament_id, team_a_id, team_b_id, score_a, score_b, winner_id, status, round_number)
        values ('f6000000-0000-4000-8000-000000000001',
                'b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000001',
                13, -1, 'b6000000-0000-4000-8000-000000000001', 'completed', 4) $sql$,
  '23514', 'new row for relation "tournament_matches" violates check constraint "tournament_matches_completed_score_valid"',
  'cas 2d: 13 à -1 refusé — score négatif');

select pg_temp.assert_blocked(
  $sql$ insert into public.tournament_matches
          (tournament_id, team_a_id, team_b_id, score_a, score_b, winner_id, status, round_number)
        values ('f6000000-0000-4000-8000-000000000001',
                'b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000001',
                14, 0, 'b6000000-0000-4000-8000-000000000001', 'completed', 4) $sql$,
  '23514', 'new row for relation "tournament_matches" violates check constraint "tournament_matches_winner_scores_13"',
  'cas 2e: 14-0 refusé — motif réel des données corrigées');

select pg_temp.assert_blocked(
  $sql$ insert into public.tournament_matches
          (tournament_id, team_a_id, team_b_id, score_a, score_b, winner_id, status, round_number)
        values ('f6000000-0000-4000-8000-000000000001',
                'b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000001',
                14, 13, 'b6000000-0000-4000-8000-000000000001', 'completed', 4) $sql$,
  '23514', 'new row for relation "tournament_matches" violates check constraint "tournament_matches_loser_between_0_and_12"',
  'cas 2f: 14-13 refusé — perdant au-delà de 12');

-- ----------------------------------------------------------------------------
-- Cas 3 — garde par statut : un match pending (scores NULL) passe les
-- nouvelles CHECK comme avant.
-- ----------------------------------------------------------------------------

insert into public.tournament_matches (id, tournament_id, team_a_id, team_b_id, score_a, score_b, winner_id, status, round_number) values
  ('e6000000-0000-4000-8000-000000000004', 'f6000000-0000-4000-8000-000000000001',
   'b6000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000001',
   null, null, null, 'pending', 4);

select pg_temp.assert_eq_int(
  (select count(*) from public.tournament_matches
    where id = 'e6000000-0000-4000-8000-000000000004'),
  1, 'cas 3: match pending accepté, scores NULL');

-- ----------------------------------------------------------------------------
-- Cas 4 — l'UPDATE est couvert aussi (vecteur réel de la saisie de score) :
-- pousser le 13-0 à 20-0 est refusé, le match reste 13-0.
-- ----------------------------------------------------------------------------

select pg_temp.assert_blocked(
  $sql$ update public.tournament_matches set score_a = 20
         where id = 'e6000000-0000-4000-8000-000000000001' $sql$,
  '23514', 'new row for relation "tournament_matches" violates check constraint "tournament_matches_winner_scores_13"',
  'cas 4a: UPDATE 13-0 → 20-0 refusé');

select pg_temp.assert_eq_int(
  (select score_a from public.tournament_matches
    where id = 'e6000000-0000-4000-8000-000000000001' and score_b = 0),
  13, 'cas 4b: le match est resté 13-0');

-- ----------------------------------------------------------------------------
-- Récapitulatif lisible avant rollback.
-- ----------------------------------------------------------------------------

select m.round_number,
       m.status,
       m.score_a,
       m.score_b,
       ta.name as team_a,
       tb.name as team_b
  from public.tournament_matches m
  join public.teams ta on ta.id = m.team_a_id
  join public.teams tb on tb.id = m.team_b_id
 where m.tournament_id = 'f6000000-0000-4000-8000-000000000001'
 order by m.round_number;

select 'tournament_score_check: OK — cas 1 à 4 verts (11 assertions)' as result;

rollback;
