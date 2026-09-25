-- ============================================================================
-- match_lifecycle_guard_check.sql — vérification manuelle de la garde du
-- cycle de vie des matchs (migration 20260925120000_match_lifecycle_guard,
-- lot DB-2).
--
-- HORS CI : pas d'infra DB de test dans ce projet. À exécuter à la main dans
-- le SQL Editor de Supabase Studio (ou psql sur la stack locale). Tout est
-- encadré par begin/rollback : aucune ligne ne reste en base. Si une
-- assertion échoue, un raise exception interrompt le script — la
-- transaction avortée annule tout de toute façon.
--
-- Simulation d'identité :
--   - request.jwt.claims (set_config transaction-local) alimente auth.uid()
--     dans les RPC SECURITY DEFINER et la RLS.
--   - set local role authenticated / anon / reset role éprouve les DROITS
--     réels (privilèges puis RLS) ; en postgres, on éprouve le trigger seul,
--     hors privilèges — « quel que soit le chemin ».
--
-- Sémantique attendue :
--   - match sur un brouillon (INSERT, re-parentage, ou brouillon créé après
--     le match dans la même instruction) → P0001 'tournament_not_started'
--   - INSERT direct par un rôle applicatif → 42501 (privilège révoqué), et
--     42501 encore (RLS, aucune politique INSERT) si le privilège revenait
--   - retour en brouillon depuis en cours → P0001 'tournament_started' ;
--     depuis terminé → P0001 'tournament_completed' (le gel lève d'abord)
--   - lot incomplet → P0001 'incomplete_matches', rien écrit
--   - lecture, saisie de score, suppressions (match, équipe, tournoi) et
--     leurs cascades : inchangées
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- Parité d'environnement : sur le projet hébergé, authenticated a les
-- privilèges DML sur les tables applicatives — ces GRANT y sont des no-ops.
-- Une stack locale peut ne pas les poser : posés ici, DANS la transaction.
-- VOLONTAIREMENT pas d'insert sur tournament_matches : DB-2 l'a révoqué, le
-- reposer ici testerait un état qui n'existe plus.
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

-- Un tournoi doit être dans l'état attendu : statut, nombre de matchs.
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
-- Fixtures (en postgres, owner des tables : bypass RLS ; les triggers, eux,
-- s'appliquent — aucune fixture n'insère de match sur un brouillon).
--   L1 : brouillon, 3 équipes                     → la RPC (lot incomplet / complet)
--   L2 : brouillon, 2 équipes                     → garde à l'INSERT, chemin direct
--   L3 : en cours, 3 équipes, 1 match en attente  → témoins, re-parentage, retour
--                                                   en brouillon, score, lecture
--   L4 : en cours, 3 équipes, 3 matchs            → cascades (équipe, tournoi)
--   L5 : en cours puis terminé, 1 match complété  → gel vs garde (ordre des triggers)
--   L6 : brouillon, 2 équipes                     → cible de re-parentage
-- ----------------------------------------------------------------------------

insert into auth.users (id, email, aud, role, created_at, updated_at) values
  ('d3000000-0000-4000-8000-000000000001', 'guard-owner@petankup.test', 'authenticated', 'authenticated', now(), now()),
  ('d3000000-0000-4000-8000-000000000002', 'guard-other@petankup.test', 'authenticated', 'authenticated', now(), now());

insert into public.tournaments (id, owner_id, name, date, status) values
  ('f4000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000001', 'guard-check-rpc',        current_date, 'draft'),
  ('f4000000-0000-4000-8000-000000000002', 'd3000000-0000-4000-8000-000000000001', 'guard-check-brouillon',  current_date, 'draft'),
  ('f4000000-0000-4000-8000-000000000003', 'd3000000-0000-4000-8000-000000000001', 'guard-check-en-cours',   current_date, 'in_progress'),
  ('f4000000-0000-4000-8000-000000000004', 'd3000000-0000-4000-8000-000000000001', 'guard-check-cascades',   current_date, 'in_progress'),
  ('f4000000-0000-4000-8000-000000000005', 'd3000000-0000-4000-8000-000000000001', 'guard-check-termine',    current_date, 'in_progress'),
  ('f4000000-0000-4000-8000-000000000006', 'd3000000-0000-4000-8000-000000000001', 'guard-check-cible',      current_date, 'draft');

-- Équipes : préfixe a/b/c = équipe, suffixe = tournoi.
insert into public.teams (id, tournament_id, name) values
  ('a4000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', 'Alpha'),
  ('b4000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', 'Bravo'),
  ('c4000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', 'Charlie'),
  ('a4000000-0000-4000-8000-000000000002', 'f4000000-0000-4000-8000-000000000002', 'Alpha'),
  ('b4000000-0000-4000-8000-000000000002', 'f4000000-0000-4000-8000-000000000002', 'Bravo'),
  ('a4000000-0000-4000-8000-000000000003', 'f4000000-0000-4000-8000-000000000003', 'Alpha'),
  ('b4000000-0000-4000-8000-000000000003', 'f4000000-0000-4000-8000-000000000003', 'Bravo'),
  ('c4000000-0000-4000-8000-000000000003', 'f4000000-0000-4000-8000-000000000003', 'Charlie'),
  ('a4000000-0000-4000-8000-000000000004', 'f4000000-0000-4000-8000-000000000004', 'Alpha'),
  ('b4000000-0000-4000-8000-000000000004', 'f4000000-0000-4000-8000-000000000004', 'Bravo'),
  ('c4000000-0000-4000-8000-000000000004', 'f4000000-0000-4000-8000-000000000004', 'Charlie'),
  ('a4000000-0000-4000-8000-000000000005', 'f4000000-0000-4000-8000-000000000005', 'Alpha'),
  ('b4000000-0000-4000-8000-000000000005', 'f4000000-0000-4000-8000-000000000005', 'Bravo'),
  ('a4000000-0000-4000-8000-000000000006', 'f4000000-0000-4000-8000-000000000006', 'Alpha'),
  ('b4000000-0000-4000-8000-000000000006', 'f4000000-0000-4000-8000-000000000006', 'Bravo');

-- L5 : joueurs liés pour que la complétion matérialise sans surprise.
insert into public.team_players (team_id, tournament_id, user_id, display_name) values
  ('a4000000-0000-4000-8000-000000000005', 'f4000000-0000-4000-8000-000000000005', 'd3000000-0000-4000-8000-000000000001', 'guard-owner'),
  ('b4000000-0000-4000-8000-000000000005', 'f4000000-0000-4000-8000-000000000005', 'd3000000-0000-4000-8000-000000000002', 'guard-other');

insert into public.tournament_matches (id, tournament_id, team_a_id, team_b_id, score_a, score_b, winner_id, status, round_number) values
  -- L3 : Alpha-Bravo en attente.
  ('de400000-0000-4000-8000-000000000031', 'f4000000-0000-4000-8000-000000000003', 'a4000000-0000-4000-8000-000000000003', 'b4000000-0000-4000-8000-000000000003', null, null, null, 'pending', 1),
  -- L4 : les trois paires.
  ('de400000-0000-4000-8000-000000000041', 'f4000000-0000-4000-8000-000000000004', 'a4000000-0000-4000-8000-000000000004', 'b4000000-0000-4000-8000-000000000004', null, null, null, 'pending', 1),
  ('de400000-0000-4000-8000-000000000042', 'f4000000-0000-4000-8000-000000000004', 'a4000000-0000-4000-8000-000000000004', 'c4000000-0000-4000-8000-000000000004', null, null, null, 'pending', 2),
  ('de400000-0000-4000-8000-000000000043', 'f4000000-0000-4000-8000-000000000004', 'b4000000-0000-4000-8000-000000000004', 'c4000000-0000-4000-8000-000000000004', null, null, null, 'pending', 3),
  -- L5 : Alpha bat Bravo.
  ('de400000-0000-4000-8000-000000000051', 'f4000000-0000-4000-8000-000000000005', 'a4000000-0000-4000-8000-000000000005', 'b4000000-0000-4000-8000-000000000005', 13, 7, 'a4000000-0000-4000-8000-000000000005', 'completed', 1);

update public.tournaments set status = 'completed'
 where id = 'f4000000-0000-4000-8000-000000000005';

-- Identité simulée = owner, pour auth.uid() (RPC) et la RLS (role authenticated).
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd3000000-0000-4000-8000-000000000001',
                    'role', 'authenticated')::text,
  true);

-- ----------------------------------------------------------------------------
-- Cas 1 — la garde, quel que soit le chemin (en postgres : hors privilèges,
-- hors RLS — seul le trigger répond).
-- ----------------------------------------------------------------------------

-- 1a : INSERT sur un brouillon → refusé.
select pg_temp.assert_blocked(
  $sql$ insert into public.tournament_matches (tournament_id, team_a_id, team_b_id, status, round_number)
        values ('f4000000-0000-4000-8000-000000000002',
                'a4000000-0000-4000-8000-000000000002',
                'b4000000-0000-4000-8000-000000000002',
                'pending', 1) $sql$,
  'P0001', 'tournament_not_started', 'cas 1a: INSERT sur un brouillon (postgres)');
select pg_temp.assert_untouched_draft('f4000000-0000-4000-8000-000000000002', 'cas 1a');

-- 1b : témoin — INSERT sur un tournoi en cours → passe.
select pg_temp.assert_row_count(
  $sql$ insert into public.tournament_matches (id, tournament_id, team_a_id, team_b_id, status, round_number)
        values ('de400000-0000-4000-8000-000000000032',
                'f4000000-0000-4000-8000-000000000003',
                'a4000000-0000-4000-8000-000000000003',
                'c4000000-0000-4000-8000-000000000003',
                'pending', 2) $sql$,
  1, 'cas 1b: INSERT sur un tournoi en cours (postgres)');

-- 1c : re-parentage d'un match vers un brouillon (les FK composites forcent
-- à changer les équipes avec tournament_id) → refusé.
select pg_temp.assert_blocked(
  $sql$ update public.tournament_matches
           set tournament_id = 'f4000000-0000-4000-8000-000000000006',
               team_a_id = 'a4000000-0000-4000-8000-000000000006',
               team_b_id = 'b4000000-0000-4000-8000-000000000006'
         where id = 'de400000-0000-4000-8000-000000000031' $sql$,
  'P0001', 'tournament_not_started', 'cas 1c: re-parentage vers un brouillon');
select pg_temp.assert_untouched_draft('f4000000-0000-4000-8000-000000000006', 'cas 1c');
select pg_temp.assert_state('f4000000-0000-4000-8000-000000000003', 'in_progress', 2, 'cas 1c: source intacte');

-- 1d : UPDATE de score en postgres → passe (la garde ne regarde que
-- tournament_id).
select pg_temp.assert_row_count(
  $sql$ update public.tournament_matches
           set score_a = 13, score_b = 7,
               winner_id = 'a4000000-0000-4000-8000-000000000003', status = 'completed'
         where id = 'de400000-0000-4000-8000-000000000032' $sql$,
  1, 'cas 1d: UPDATE de score (postgres)');

-- 1e : UNE instruction à CTE modifiantes — le match écrit AVANT son tournoi
-- (brouillon), les FK vérifiées en fin d'instruction. Trouvé par la revue
-- adverse : sans garde côté tournoi, la garde des matchs ne voit rien. La
-- garde à l'insertion d'un brouillon répond.
select pg_temp.assert_blocked(
  $sql$ with inserted_match as (
          insert into public.tournament_matches (id, tournament_id, team_a_id, team_b_id, status, round_number)
          values ('de400000-0000-4000-8000-000000000071',
                  'f4000000-0000-4000-8000-000000000007',
                  'a4000000-0000-4000-8000-000000000007',
                  'b4000000-0000-4000-8000-000000000007',
                  'pending', 1)
          returning tournament_id, team_a_id, team_b_id
        ),
        inserted_tournament as (
          insert into public.tournaments (id, owner_id, name, date, status)
          select tournament_id, 'd3000000-0000-4000-8000-000000000001', 'guard-check-cte', current_date, 'draft'
            from inserted_match
          returning id
        )
        insert into public.teams (id, tournament_id, name)
        select m.team_a_id, t.id, 'Alpha' from inserted_match m, inserted_tournament t
        union all
        select m.team_b_id, t.id, 'Bravo' from inserted_match m, inserted_tournament t $sql$,
  'P0001', 'tournament_not_started', 'cas 1e: match puis brouillon en une instruction (CTE)');

-- 1f : même chose, le brouillon et ses équipes dans des CTE que personne ne
-- lit (exécutées après la requête principale, avant les FK).
select pg_temp.assert_blocked(
  $sql$ with inserted_tournament as (
          insert into public.tournaments (id, owner_id, name, date, status)
          values ('f4000000-0000-4000-8000-000000000007',
                  'd3000000-0000-4000-8000-000000000001',
                  'guard-check-cte', current_date, 'draft')
        ),
        inserted_teams as (
          insert into public.teams (id, tournament_id, name)
          values ('a4000000-0000-4000-8000-000000000007', 'f4000000-0000-4000-8000-000000000007', 'Alpha'),
                 ('b4000000-0000-4000-8000-000000000007', 'f4000000-0000-4000-8000-000000000007', 'Bravo')
        )
        insert into public.tournament_matches (id, tournament_id, team_a_id, team_b_id, status, round_number)
        values ('de400000-0000-4000-8000-000000000071',
                'f4000000-0000-4000-8000-000000000007',
                'a4000000-0000-4000-8000-000000000007',
                'b4000000-0000-4000-8000-000000000007',
                'pending', 1) $sql$,
  'P0001', 'tournament_not_started', 'cas 1f: brouillon en CTE non lue, match en requête principale');

select pg_temp.assert_eq_int(
  (select count(*) from public.tournaments where id = 'f4000000-0000-4000-8000-000000000007'),
  0, 'cas 1e/1f: aucun tournoi créé');

-- 1g : témoin — la même instruction avec le tournoi créé EN COURS passe
-- (la garde côté tournoi ne concerne que les brouillons).
select pg_temp.assert_row_count(
  $sql$ with inserted_match as (
          insert into public.tournament_matches (id, tournament_id, team_a_id, team_b_id, status, round_number)
          values ('de400000-0000-4000-8000-000000000081',
                  'f4000000-0000-4000-8000-000000000008',
                  'a4000000-0000-4000-8000-000000000008',
                  'b4000000-0000-4000-8000-000000000008',
                  'pending', 1)
          returning tournament_id, team_a_id, team_b_id
        ),
        inserted_tournament as (
          insert into public.tournaments (id, owner_id, name, date, status)
          select tournament_id, 'd3000000-0000-4000-8000-000000000001', 'guard-check-cte-en-cours', current_date, 'in_progress'
            from inserted_match
          returning id
        )
        insert into public.teams (id, tournament_id, name)
        select m.team_a_id, t.id, 'Alpha' from inserted_match m, inserted_tournament t
        union all
        select m.team_b_id, t.id, 'Bravo' from inserted_match m, inserted_tournament t $sql$,
  2, 'cas 1g: témoin, tournoi créé en cours dans la même instruction');
select pg_temp.assert_state('f4000000-0000-4000-8000-000000000008', 'in_progress', 1, 'cas 1g');

-- ----------------------------------------------------------------------------
-- Cas 2 — le chemin direct est fermé aux rôles applicatifs : privilège
-- révoqué (couche 1), et aucune politique INSERT derrière (couche 2).
-- ----------------------------------------------------------------------------

set local role authenticated;

-- 2a : owner, INSERT sur un brouillon → 42501.
select pg_temp.assert_blocked(
  $sql$ insert into public.tournament_matches (tournament_id, team_a_id, team_b_id, status, round_number)
        values ('f4000000-0000-4000-8000-000000000002',
                'a4000000-0000-4000-8000-000000000002',
                'b4000000-0000-4000-8000-000000000002',
                'pending', 1) $sql$,
  '42501', null, 'cas 2a: INSERT direct sur un brouillon (owner)');

-- 2b : owner, INSERT sur un tournoi en cours → 42501 aussi : c'est le
-- privilège qui répond, avant toute règle de ligne.
select pg_temp.assert_blocked(
  $sql$ insert into public.tournament_matches (tournament_id, team_a_id, team_b_id, status, round_number)
        values ('f4000000-0000-4000-8000-000000000003',
                'b4000000-0000-4000-8000-000000000003',
                'c4000000-0000-4000-8000-000000000003',
                'pending', 3) $sql$,
  '42501', 'permission denied for table tournament_matches', 'cas 2b: INSERT direct sur un tournoi en cours (owner)');

reset role;

-- 2c : anon → 42501.
set local role anon;
select pg_temp.assert_blocked(
  $sql$ insert into public.tournament_matches (tournament_id, team_a_id, team_b_id, status, round_number)
        values ('f4000000-0000-4000-8000-000000000003',
                'b4000000-0000-4000-8000-000000000003',
                'c4000000-0000-4000-8000-000000000003',
                'pending', 3) $sql$,
  '42501', null, 'cas 2c: INSERT direct (anon)');
reset role;

-- 2d : couche 2 — si le privilège revenait (grant local à la transaction),
-- la RLS sans politique INSERT refuse encore.
grant insert on public.tournament_matches to authenticated;
set local role authenticated;
select pg_temp.assert_blocked(
  $sql$ insert into public.tournament_matches (tournament_id, team_a_id, team_b_id, status, round_number)
        values ('f4000000-0000-4000-8000-000000000003',
                'b4000000-0000-4000-8000-000000000003',
                'c4000000-0000-4000-8000-000000000003',
                'pending', 3) $sql$,
  '42501', 'new row violates row-level security policy for table "tournament_matches"', 'cas 2d: INSERT direct sans politique (privilège reposé)');
reset role;
revoke insert on public.tournament_matches from authenticated;

select pg_temp.assert_state('f4000000-0000-4000-8000-000000000003', 'in_progress', 2, 'cas 2: rien écrit');

-- ----------------------------------------------------------------------------
-- Cas 3 — jamais de retour en Brouillon (owner, RLS réelle).
-- ----------------------------------------------------------------------------

set local role authenticated;

-- 3a : en cours → brouillon → refusé par la garde.
select pg_temp.assert_blocked(
  $sql$ update public.tournaments set status = 'draft'
         where id = 'f4000000-0000-4000-8000-000000000003' $sql$,
  'P0001', 'tournament_started', 'cas 3a: en cours → brouillon');

-- 3b : terminé → brouillon → le gel répond d'abord (ordre des triggers :
-- tournaments_freeze_guard < tournaments_lifecycle_guard).
select pg_temp.assert_blocked(
  $sql$ update public.tournaments set status = 'draft'
         where id = 'f4000000-0000-4000-8000-000000000005' $sql$,
  'P0001', 'tournament_completed', 'cas 3b: terminé → brouillon (le gel répond)');

-- 3c : réouverture terminé → en cours : toujours permise.
select pg_temp.assert_row_count(
  $sql$ update public.tournaments set status = 'in_progress'
         where id = 'f4000000-0000-4000-8000-000000000005' $sql$,
  1, 'cas 3c: réouverture');

-- 3d : re-complétion en cours → terminé : toujours permise.
select pg_temp.assert_row_count(
  $sql$ update public.tournaments set status = 'completed'
         where id = 'f4000000-0000-4000-8000-000000000005' $sql$,
  1, 'cas 3d: re-complétion');

-- 3e : statut dans le SET mais inchangé (ce que fait l'app à chaque UPDATE)
-- → passe.
select pg_temp.assert_row_count(
  $sql$ update public.tournaments set name = 'guard-check-en-cours (renommé)', status = 'in_progress'
         where id = 'f4000000-0000-4000-8000-000000000003' $sql$,
  1, 'cas 3e: UPDATE en cours, statut inchangé');

-- 3f : brouillon → brouillon avec un autre changement → passe.
select pg_temp.assert_row_count(
  $sql$ update public.tournaments set name = 'guard-check-brouillon (renommé)', status = 'draft'
         where id = 'f4000000-0000-4000-8000-000000000002' $sql$,
  1, 'cas 3f: UPDATE brouillon, statut inchangé');

reset role;

select pg_temp.assert_state('f4000000-0000-4000-8000-000000000003', 'in_progress', 2, 'cas 3: L3 intact');
select pg_temp.assert_state('f4000000-0000-4000-8000-000000000005', 'completed', 1, 'cas 3: L5 re-terminé');

-- ----------------------------------------------------------------------------
-- Cas 4 — ce qui doit continuer (owner, RLS réelle) : score, lecture,
-- suppressions et cascades.
-- ----------------------------------------------------------------------------

set local role authenticated;

-- 4a : saisie de score sur un tournoi en cours → 1 ligne.
select pg_temp.assert_row_count(
  $sql$ update public.tournament_matches
           set score_a = 13, score_b = 9,
               winner_id = 'a4000000-0000-4000-8000-000000000003', status = 'completed'
         where id = 'de400000-0000-4000-8000-000000000031' $sql$,
  1, 'cas 4a: saisie de score (owner)');

-- 4b : lecture → les deux matchs de L3 visibles.
select pg_temp.assert_eq_int(
  (select count(*) from public.tournament_matches
    where tournament_id = 'f4000000-0000-4000-8000-000000000003'),
  2, 'cas 4b: lecture des matchs (owner)');

-- 4c : suppression d'une équipe → ses matchs partent en cascade.
select pg_temp.assert_row_count(
  $sql$ delete from public.teams where id = 'a4000000-0000-4000-8000-000000000004' $sql$,
  1, 'cas 4c: suppression d''une équipe (owner)');

-- 4e : suppression directe d'un match → politique delete intacte.
select pg_temp.assert_row_count(
  $sql$ delete from public.tournament_matches where id = 'de400000-0000-4000-8000-000000000032' $sql$,
  1, 'cas 4e: suppression directe d''un match (owner)');

reset role;

-- Cascade vérifiée en postgres : Alpha-Bravo et Alpha-Charlie partis, Bravo-Charlie reste.
select pg_temp.assert_state('f4000000-0000-4000-8000-000000000004', 'in_progress', 1, 'cas 4c: cascade équipe');
select pg_temp.assert_eq_int(
  (select count(*) from public.tournament_matches where id = 'de400000-0000-4000-8000-000000000043'),
  1, 'cas 4c: le match restant est Bravo-Charlie');

-- 4d : suppression du tournoi → ses matchs partent en cascade.
set local role authenticated;
select pg_temp.assert_row_count(
  $sql$ delete from public.tournaments where id = 'f4000000-0000-4000-8000-000000000004' $sql$,
  1, 'cas 4d: suppression du tournoi (owner)');
reset role;
select pg_temp.assert_eq_int(
  (select count(*) from public.tournament_matches
    where tournament_id = 'f4000000-0000-4000-8000-000000000004'),
  0, 'cas 4d: cascade tournoi');

-- ----------------------------------------------------------------------------
-- Cas 5 — la RPC : le lot doit couvrir toutes les paires (owner, RLS réelle).
-- L1 : 3 équipes → 3 paires attendues.
-- ----------------------------------------------------------------------------

set local role authenticated;

-- 5a : lot de 2 sur 3 paires → incomplete_matches, rien écrit.
select pg_temp.assert_blocked(
  $sql$ select public.start_tournament('f4000000-0000-4000-8000-000000000001',
          '[{"id": "de400000-0000-4000-8000-000000000011", "team_a_id": "a4000000-0000-4000-8000-000000000001", "team_b_id": "b4000000-0000-4000-8000-000000000001", "round_number": 1},
            {"id": "de400000-0000-4000-8000-000000000012", "team_a_id": "a4000000-0000-4000-8000-000000000001", "team_b_id": "c4000000-0000-4000-8000-000000000001", "round_number": 2}]'::jsonb) $sql$,
  'P0001', 'incomplete_matches', 'cas 5a: lot incomplet');

-- 5b : 3 éléments mais une paire en double (ordre inversé) — le compte seul
-- ne prouve rien, l'index unique refuse → invalid_matches, rien écrit.
select pg_temp.assert_blocked(
  $sql$ select public.start_tournament('f4000000-0000-4000-8000-000000000001',
          '[{"id": "de400000-0000-4000-8000-000000000011", "team_a_id": "a4000000-0000-4000-8000-000000000001", "team_b_id": "b4000000-0000-4000-8000-000000000001", "round_number": 1},
            {"id": "de400000-0000-4000-8000-000000000012", "team_a_id": "b4000000-0000-4000-8000-000000000001", "team_b_id": "a4000000-0000-4000-8000-000000000001", "round_number": 2},
            {"id": "de400000-0000-4000-8000-000000000013", "team_a_id": "a4000000-0000-4000-8000-000000000001", "team_b_id": "c4000000-0000-4000-8000-000000000001", "round_number": 3}]'::jsonb) $sql$,
  'P0001', 'invalid_matches', 'cas 5b: bon compte, paire en double');

reset role;

select pg_temp.assert_untouched_draft('f4000000-0000-4000-8000-000000000001', 'cas 5a/5b: rien écrit');

-- 5c : lot complet → démarre.
set local role authenticated;
select public.start_tournament(
  'f4000000-0000-4000-8000-000000000001',
  '[{"id": "de400000-0000-4000-8000-000000000011", "team_a_id": "a4000000-0000-4000-8000-000000000001", "team_b_id": "b4000000-0000-4000-8000-000000000001", "round_number": 1},
    {"id": "de400000-0000-4000-8000-000000000012", "team_a_id": "a4000000-0000-4000-8000-000000000001", "team_b_id": "c4000000-0000-4000-8000-000000000001", "round_number": 2},
    {"id": "de400000-0000-4000-8000-000000000013", "team_a_id": "b4000000-0000-4000-8000-000000000001", "team_b_id": "c4000000-0000-4000-8000-000000000001", "round_number": 3}]'::jsonb);
reset role;

select pg_temp.assert_state('f4000000-0000-4000-8000-000000000001', 'in_progress', 3, 'cas 5c: lot complet');

-- ----------------------------------------------------------------------------
-- Récapitulatif lisible avant rollback.
-- ----------------------------------------------------------------------------

select t.name,
       t.status,
       (select count(*) from public.tournament_matches m where m.tournament_id = t.id) as match_count
  from public.tournaments t
 where t.name like 'guard-check-%'
 order by t.name;

rollback;
