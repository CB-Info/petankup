-- ============================================================================
-- free_match_check.sql — vérification manuelle du modèle du match libre
-- (migration 20260828100000_free_match_schema).
--
-- HORS CI : à exécuter à la main dans le SQL Editor de Supabase Studio (ou
-- psql sur la stack locale). Tout est encadré par begin/rollback : aucune
-- ligne ne reste en base. Si une assertion échoue, un raise exception
-- interrompt le script — la transaction avortée annule tout de toute façon.
--
-- Sémantique attendue (cf. en-tête de la migration) :
--   - RPC create_free_match : erreurs typées (P0001, message = code).
--   - Écriture directe (INSERT / UPDATE) sur free_matches et
--     free_match_players sous authenticated : 42501, privilège absent —
--     l'absence de policy UPDATE est la seconde couche, jamais atteinte.
--   - DELETE direct par un non-créateur : 0 ligne (privilège accordé, USING
--     filtre) ; par le créateur : 1 ligne.
--   - user_free_match_stats : deny-total (42501 en direct) ; lue en postgres.
--
-- Parité d'environnement : AUCUN bloc GRANT ici. Les nouvelles tables
-- tiennent leurs grants de la migration, sur tous les environnements ; leur
-- ré-accorder insert/update ferait passer les cas d'immutabilité sur un état
-- qui n'existe pas en production. Ce harnais ne touche aux tables de tournoi
-- qu'en postgres (fixtures du cas 13).
--
-- Simulation d'identité : pg_temp.act_as(<user>) pose request.jwt.claims
-- (set_config transaction-local, traverse les DEFINER : auth.uid() = le user
-- simulé) puis set local role authenticated ; reset role rend la main à
-- postgres pour les lectures de contrôle.
--
-- Décor : U1 (créateur), U2, U3, U4 (tiers, jamais participant d'un match
-- libre). Les pseudos des profils (créés par trigger) sont capturés dans
-- pg_temp.fixture_profile avant toute suppression de compte — D.1 peut
-- suffixer un pseudo en collision, on ne compare jamais à une constante.
--
-- Cas (numérotation du ticket H2.a §4 ; ordre d'exécution 1-9, 13, 10, 11 :
-- la suppression de U1 (cas 13) précède celles de U2 et U3 pour pouvoir
-- vérifier « les statistiques des autres participants sont inchangées ») :
--   1  nominal 2c2 mixte (U1 + libre / U2 + libre), 13-7, privé → stats.
--   2  équilibre des camps (S9 révisée) : 2c3 et 1c2 → unbalanced_sides ;
--      3c3 accepté (M2, triplette).
--   3  bornes : camp vide, 4c1, 4c4 → invalid_side_count (l'effectif se
--      vérifie avant l'équilibre : un 4c4 échoue pour effectif).
--   4  même compte dans les deux camps → duplicate_player.
--   5  créateur non participant → not_participant.
--   6  scores : 13-13, 12-5, 20-0 rejetés ; 13-12, 13-0, 5-13 acceptés
--      (trois tête-à-tête, 1c1) ;
--      CHECK en filet (insert direct en postgres) ; date future rejetée.
--   7  immuabilité : UPDATE / INSERT directs → 42501 ; stats directes → 42501.
--   8  suppression : U2 → 0 ligne ; U4 → 0 ligne ; U1 → 1 ligne, stats.
--   9  visibilité : privé (U2 et U3 voient, U4 non), public (U4 voit) — sur
--      les DEUX tables (éprouve l'absence de récursion RLS du helper).
--   13 garde « compte disparu » : U1 owner + joueur d'un tournoi terminé ET
--      participant de matchs libres → suppression du compte RÉUSSIE (bug
--      latent corrigé) ; matchs survivants, stats des autres inchangées.
--      ⚠️ Artefact de transaction unique : Postgres re-vérifie les FK à
--      l'UPDATE des lignes insérées dans la MÊME transaction ; le SET NULL
--      de team_players de U1 tomberait sur une équipe déjà cascadée (23503
--      team_players_team_belongs_to_tournament) — hors harnais, fixtures
--      committées, la suppression passe (vérifié). Pour rester en
--      begin/rollback, la ligne team_players de U1 est retirée en postgres
--      avant la suppression ; le résultat matérialisé subsiste, et c'est lui
--      qui déclenche le recompute fautif.
--   10 S7 : suppression du compte U2 → le match avec U3 survit, pseudo
--      conservé, stats de U3 inchangées ; les matchs dont U2 était le
--      dernier compte disparaissent (S8 en passant).
--   11 S8 : suppression de U3, dernier compte du match restant → plus rien.
--   12 non-régression : tournament_freeze_check, ranking_fixtures_check et
--      viewer_can_open_check sont rejoués SÉPARÉMENT (fichiers autonomes).
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

-- Compare la ligne user_free_match_stats d'un user (lecture en postgres).
create function pg_temp.assert_free_stats(
  p_user uuid,
  p_played int, p_wins int, p_losses int, p_scored int, p_conceded int,
  p_label text
) returns void
language plpgsql
as $$
declare
  v_row public.user_free_match_stats%rowtype;
begin
  select * into v_row from public.user_free_match_stats where user_id = p_user;
  if not found then
    raise exception '[%] aucune ligne user_free_match_stats pour %', p_label, p_user;
  end if;
  if (v_row.matches_played, v_row.wins, v_row.losses, v_row.points_scored, v_row.points_conceded)
     is distinct from (p_played, p_wins, p_losses, p_scored, p_conceded) then
    raise exception '[%] stats attendues (joués %, V %, D %, marqués %, encaissés %), obtenues (%, %, %, %, %)',
      p_label, p_played, p_wins, p_losses, p_scored, p_conceded,
      v_row.matches_played, v_row.wins, v_row.losses, v_row.points_scored, v_row.points_conceded;
  end if;
end;
$$;

-- Identité simulée : claims + rôle authenticated (transaction-locaux).
create function pg_temp.act_as(p_user uuid) returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text,
    true);
  execute 'set local role authenticated';
end;
$$;

-- Mémoire des matchs créés par la RPC (label → id), lisible sous authenticated.
create table pg_temp.created_matches (label text primary key, id uuid not null);
grant select, insert on table pg_temp.created_matches to authenticated;

create function pg_temp.match_id(p_label text) returns uuid
language sql
as $$
  select id from pg_temp.created_matches where label = p_label;
$$;

-- ----------------------------------------------------------------------------
-- Fixtures (en postgres). Le trigger handle_new_user_profile crée les profils.
-- ----------------------------------------------------------------------------

insert into auth.users (id, email, aud, role, created_at, updated_at) values
  ('c1000000-0000-4000-8000-000000000001', 'fm-check-u1@petankup.test', 'authenticated', 'authenticated', now(), now()),
  ('c1000000-0000-4000-8000-000000000002', 'fm-check-u2@petankup.test', 'authenticated', 'authenticated', now(), now()),
  ('c1000000-0000-4000-8000-000000000003', 'fm-check-u3@petankup.test', 'authenticated', 'authenticated', now(), now()),
  ('c1000000-0000-4000-8000-000000000004', 'fm-check-u4@petankup.test', 'authenticated', 'authenticated', now(), now());

create table pg_temp.fixture_profile as
  select id, display_name from public.profiles
   where id in ('c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002',
                'c1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000004');

select pg_temp.assert_eq_int((select count(*) from pg_temp.fixture_profile), 4, 'setup: 4 profils créés');

-- ----------------------------------------------------------------------------
-- Cas 1 — création nominale 2c2 mixte par U1 : U1 + « Marcel » contre
-- U2 + « Gérard », 13-7, privé.
-- ----------------------------------------------------------------------------

select pg_temp.act_as('c1000000-0000-4000-8000-000000000001');

insert into pg_temp.created_matches (label, id)
select 'M1', public.create_free_match(
  null, 'private', 13, 7,
  jsonb_build_array(
    jsonb_build_object('side', 'A', 'user_id', 'c1000000-0000-4000-8000-000000000001'),
    jsonb_build_object('side', 'A', 'user_id', null, 'display_name', '  Marcel '),
    jsonb_build_object('side', 'B', 'user_id', 'c1000000-0000-4000-8000-000000000002'),
    jsonb_build_object('side', 'B', 'user_id', null, 'display_name', 'Gérard')
  ));

reset role;

select pg_temp.assert_eq_int(
  (select count(*) from public.free_matches
    where id = pg_temp.match_id('M1')
      and created_by = 'c1000000-0000-4000-8000-000000000001'
      and visibility = 'private'
      and played_on = (timezone('Europe/Paris', now()))::date),
  1, 'cas 1: match créé (créateur, privé, joué aujourd''hui à Paris)');
select pg_temp.assert_eq_int(
  (select count(*) from public.free_match_players where match_id = pg_temp.match_id('M1')),
  4, 'cas 1: 4 participants');
select pg_temp.assert_eq_int(
  (select count(*) from public.free_match_players
    where match_id = pg_temp.match_id('M1') and side = 'A' and user_id is null and display_name = 'Marcel'),
  1, 'cas 1: joueur libre, nom saisi conservé (trim)');
select pg_temp.assert_eq_int(
  (select count(*) from public.free_match_players p
     join pg_temp.fixture_profile f on f.id = p.user_id
    where p.match_id = pg_temp.match_id('M1') and p.display_name = f.display_name),
  2, 'cas 1: pseudo des comptes figé depuis profiles');
select pg_temp.assert_free_stats('c1000000-0000-4000-8000-000000000001', 1, 1, 0, 13, 7, 'cas 1: stats U1');
select pg_temp.assert_free_stats('c1000000-0000-4000-8000-000000000002', 1, 0, 1, 7, 13, 'cas 1: stats U2');
select pg_temp.assert_eq_int((select count(*) from public.user_free_match_stats), 2,
  'cas 1: aucune ligne de stats pour les joueurs libres');

-- ----------------------------------------------------------------------------
-- Cas 2 — équilibre des camps (S9 révisée) : 2c3 et 1c2 refusés pour
-- déséquilibre ; 3c3 accepté (triplette) : U1 + Marcel + Paulette contre
-- U2 + U3 + Gérard, 13-11.
-- ----------------------------------------------------------------------------

select pg_temp.act_as('c1000000-0000-4000-8000-000000000001');

select pg_temp.assert_blocked(
  $sql$ select public.create_free_match(null, null, 13, 11, jsonb_build_array(
          jsonb_build_object('side', 'A', 'user_id', 'c1000000-0000-4000-8000-000000000001'),
          jsonb_build_object('side', 'A', 'user_id', null, 'display_name', 'Marcel'),
          jsonb_build_object('side', 'B', 'user_id', 'c1000000-0000-4000-8000-000000000002'),
          jsonb_build_object('side', 'B', 'user_id', 'c1000000-0000-4000-8000-000000000003'),
          jsonb_build_object('side', 'B', 'user_id', null, 'display_name', 'Gérard'))) $sql$,
  'P0001', 'unbalanced_sides', 'cas 2a: 2c3 refusé pour déséquilibre');

select pg_temp.assert_blocked(
  $sql$ select public.create_free_match(null, null, 13, 11, jsonb_build_array(
          jsonb_build_object('side', 'A', 'user_id', 'c1000000-0000-4000-8000-000000000001'),
          jsonb_build_object('side', 'B', 'user_id', 'c1000000-0000-4000-8000-000000000002'),
          jsonb_build_object('side', 'B', 'user_id', null, 'display_name', 'Gérard'))) $sql$,
  'P0001', 'unbalanced_sides', 'cas 2b: 1c2 refusé pour déséquilibre');

insert into pg_temp.created_matches (label, id)
select 'M2', public.create_free_match(
  null, null, 13, 11,
  jsonb_build_array(
    jsonb_build_object('side', 'A', 'user_id', 'c1000000-0000-4000-8000-000000000001'),
    jsonb_build_object('side', 'A', 'user_id', null, 'display_name', 'Marcel'),
    jsonb_build_object('side', 'A', 'user_id', null, 'display_name', 'Paulette'),
    jsonb_build_object('side', 'B', 'user_id', 'c1000000-0000-4000-8000-000000000002'),
    jsonb_build_object('side', 'B', 'user_id', 'c1000000-0000-4000-8000-000000000003'),
    jsonb_build_object('side', 'B', 'user_id', null, 'display_name', 'Gérard')
  ));

reset role;

select pg_temp.assert_eq_int(
  (select count(*) from public.free_matches where id = pg_temp.match_id('M2') and visibility = 'private'),
  1, 'cas 2c: 3c3 accepté, visibilité null → private');
select pg_temp.assert_eq_int(
  (select count(*) from public.free_match_players where match_id = pg_temp.match_id('M2')),
  6, 'cas 2c: triplette, 6 participants');
select pg_temp.assert_free_stats('c1000000-0000-4000-8000-000000000001', 2, 2, 0, 26, 18, 'cas 2: stats U1');
select pg_temp.assert_free_stats('c1000000-0000-4000-8000-000000000002', 2, 0, 2, 18, 26, 'cas 2: stats U2');
select pg_temp.assert_free_stats('c1000000-0000-4000-8000-000000000003', 1, 0, 1, 11, 13, 'cas 2: stats U3');

-- ----------------------------------------------------------------------------
-- Cas 3 — bornes par camp : camp B vide ; 4c1 ; 4c4. L'effectif se vérifie
-- avant l'équilibre : un 4c4 échoue pour effectif, pas pour déséquilibre.
-- ----------------------------------------------------------------------------

select pg_temp.act_as('c1000000-0000-4000-8000-000000000001');

select pg_temp.assert_blocked(
  $sql$ select public.create_free_match(null, 'private', 13, 7, jsonb_build_array(
          jsonb_build_object('side', 'A', 'user_id', 'c1000000-0000-4000-8000-000000000001'))) $sql$,
  'P0001', 'invalid_side_count', 'cas 3a: camp B vide');

select pg_temp.assert_blocked(
  $sql$ select public.create_free_match(null, 'private', 13, 7, jsonb_build_array(
          jsonb_build_object('side', 'A', 'user_id', 'c1000000-0000-4000-8000-000000000001'),
          jsonb_build_object('side', 'A', 'user_id', null, 'display_name', 'a'),
          jsonb_build_object('side', 'A', 'user_id', null, 'display_name', 'b'),
          jsonb_build_object('side', 'A', 'user_id', null, 'display_name', 'c'),
          jsonb_build_object('side', 'B', 'user_id', 'c1000000-0000-4000-8000-000000000002'))) $sql$,
  'P0001', 'invalid_side_count', 'cas 3b: 4c1 refusé pour effectif');

select pg_temp.assert_blocked(
  $sql$ select public.create_free_match(null, 'private', 13, 7, jsonb_build_array(
          jsonb_build_object('side', 'A', 'user_id', 'c1000000-0000-4000-8000-000000000001'),
          jsonb_build_object('side', 'A', 'user_id', null, 'display_name', 'a'),
          jsonb_build_object('side', 'A', 'user_id', null, 'display_name', 'b'),
          jsonb_build_object('side', 'A', 'user_id', null, 'display_name', 'c'),
          jsonb_build_object('side', 'B', 'user_id', 'c1000000-0000-4000-8000-000000000002'),
          jsonb_build_object('side', 'B', 'user_id', null, 'display_name', 'd'),
          jsonb_build_object('side', 'B', 'user_id', null, 'display_name', 'e'),
          jsonb_build_object('side', 'B', 'user_id', null, 'display_name', 'f'))) $sql$,
  'P0001', 'invalid_side_count', 'cas 3c: 4c4 refusé pour effectif, pas pour déséquilibre');

-- ----------------------------------------------------------------------------
-- Cas 4 — le même compte dans les deux camps.
-- ----------------------------------------------------------------------------

-- Payload équilibré (2c2) : l'équilibre des camps se vérifie avant le doublon.
select pg_temp.assert_blocked(
  $sql$ select public.create_free_match(null, 'private', 13, 7, jsonb_build_array(
          jsonb_build_object('side', 'A', 'user_id', 'c1000000-0000-4000-8000-000000000001'),
          jsonb_build_object('side', 'A', 'user_id', 'c1000000-0000-4000-8000-000000000002'),
          jsonb_build_object('side', 'B', 'user_id', 'c1000000-0000-4000-8000-000000000002'),
          jsonb_build_object('side', 'B', 'user_id', null, 'display_name', 'Gérard'))) $sql$,
  'P0001', 'duplicate_player', 'cas 4: U2 des deux côtés');

-- ----------------------------------------------------------------------------
-- Cas 5 — créateur non participant : U4 crée un match U1 contre U2 ; U1 crée
-- un match entre joueurs libres seulement.
-- ----------------------------------------------------------------------------

reset role;
select pg_temp.act_as('c1000000-0000-4000-8000-000000000004');

select pg_temp.assert_blocked(
  $sql$ select public.create_free_match(null, 'private', 13, 7, jsonb_build_array(
          jsonb_build_object('side', 'A', 'user_id', 'c1000000-0000-4000-8000-000000000001'),
          jsonb_build_object('side', 'B', 'user_id', 'c1000000-0000-4000-8000-000000000002'))) $sql$,
  'P0001', 'not_participant', 'cas 5a: U4 absent du match');

reset role;
select pg_temp.act_as('c1000000-0000-4000-8000-000000000001');

select pg_temp.assert_blocked(
  $sql$ select public.create_free_match(null, 'private', 13, 7, jsonb_build_array(
          jsonb_build_object('side', 'A', 'user_id', null, 'display_name', 'Marcel'),
          jsonb_build_object('side', 'B', 'user_id', null, 'display_name', 'Gérard'))) $sql$,
  'P0001', 'not_participant', 'cas 5b: aucun compte, créateur absent');

-- ----------------------------------------------------------------------------
-- Cas 6 — règle de score stricte (vainqueur à 13 exactement, perdant 0-12)
-- et date de jeu jamais future. U1 contre U2.
-- ----------------------------------------------------------------------------

select pg_temp.assert_blocked(
  $sql$ select public.create_free_match(null, 'private', 13, 13, jsonb_build_array(
          jsonb_build_object('side', 'A', 'user_id', 'c1000000-0000-4000-8000-000000000001'),
          jsonb_build_object('side', 'B', 'user_id', 'c1000000-0000-4000-8000-000000000002'))) $sql$,
  'P0001', 'invalid_score', 'cas 6a: 13-13 rejeté');
select pg_temp.assert_blocked(
  $sql$ select public.create_free_match(null, 'private', 12, 5, jsonb_build_array(
          jsonb_build_object('side', 'A', 'user_id', 'c1000000-0000-4000-8000-000000000001'),
          jsonb_build_object('side', 'B', 'user_id', 'c1000000-0000-4000-8000-000000000002'))) $sql$,
  'P0001', 'invalid_score', 'cas 6b: 12-5 rejeté');
select pg_temp.assert_blocked(
  $sql$ select public.create_free_match(null, 'private', 20, 0, jsonb_build_array(
          jsonb_build_object('side', 'A', 'user_id', 'c1000000-0000-4000-8000-000000000001'),
          jsonb_build_object('side', 'B', 'user_id', 'c1000000-0000-4000-8000-000000000002'))) $sql$,
  'P0001', 'invalid_score', 'cas 6c: 20-0 rejeté');
select pg_temp.assert_blocked(
  $sql$ select public.create_free_match(null, 'private', 13, -1, jsonb_build_array(
          jsonb_build_object('side', 'A', 'user_id', 'c1000000-0000-4000-8000-000000000001'),
          jsonb_build_object('side', 'B', 'user_id', 'c1000000-0000-4000-8000-000000000002'))) $sql$,
  'P0001', 'invalid_score', 'cas 6d: 13 à -1 rejeté');
select pg_temp.assert_blocked(
  $sql$ select public.create_free_match(
          (timezone('Europe/Paris', now()))::date + 1, 'private', 13, 7, jsonb_build_array(
          jsonb_build_object('side', 'A', 'user_id', 'c1000000-0000-4000-8000-000000000001'),
          jsonb_build_object('side', 'B', 'user_id', 'c1000000-0000-4000-8000-000000000002'))) $sql$,
  'P0001', 'invalid_played_on', 'cas 6e: date de jeu future rejetée');

insert into pg_temp.created_matches (label, id)
select 'M3', public.create_free_match(
  (timezone('Europe/Paris', now()))::date - 1, 'private', 13, 12,
  jsonb_build_array(
    jsonb_build_object('side', 'A', 'user_id', 'c1000000-0000-4000-8000-000000000001'),
    jsonb_build_object('side', 'B', 'user_id', 'c1000000-0000-4000-8000-000000000002')));
insert into pg_temp.created_matches (label, id)
select 'M4', public.create_free_match(
  null, 'private', 13, 0,
  jsonb_build_array(
    jsonb_build_object('side', 'A', 'user_id', 'c1000000-0000-4000-8000-000000000001'),
    jsonb_build_object('side', 'B', 'user_id', 'c1000000-0000-4000-8000-000000000002')));
insert into pg_temp.created_matches (label, id)
select 'M5', public.create_free_match(
  null, 'private', 5, 13,
  jsonb_build_array(
    jsonb_build_object('side', 'A', 'user_id', 'c1000000-0000-4000-8000-000000000001'),
    jsonb_build_object('side', 'B', 'user_id', 'c1000000-0000-4000-8000-000000000002')));

reset role;

select pg_temp.assert_eq_int(
  (select count(*) from public.free_matches
    where id in (pg_temp.match_id('M3'), pg_temp.match_id('M4'), pg_temp.match_id('M5'))),
  3, 'cas 6f: 13-12 (hier), 13-0 et 5-13 acceptés');
select pg_temp.assert_eq_int(
  (select count(*) from public.free_match_players where match_id = pg_temp.match_id('M3')),
  2, 'cas 6f: tête-à-tête (1c1) accepté');
select pg_temp.assert_free_stats('c1000000-0000-4000-8000-000000000001', 5, 4, 1, 57, 43, 'cas 6: stats U1');
select pg_temp.assert_free_stats('c1000000-0000-4000-8000-000000000002', 5, 1, 4, 43, 57, 'cas 6: stats U2 (miroir)');

-- Filet de sécurité : les CHECK nommées répondent aussi en insert direct
-- (postgres, hors RPC) — le message cite la contrainte de la BONNE table.
select pg_temp.assert_blocked(
  $sql$ insert into public.free_matches (created_by, score_a, score_b)
        values ('c1000000-0000-4000-8000-000000000001', 20, 0) $sql$,
  '23514', 'new row for relation "free_matches" violates check constraint "free_matches_winner_scores_13"',
  'cas 6g: CHECK vainqueur à 13');
select pg_temp.assert_blocked(
  $sql$ insert into public.free_matches (created_by, score_a, score_b)
        values ('c1000000-0000-4000-8000-000000000001', 13, 13) $sql$,
  '23514', 'new row for relation "free_matches" violates check constraint "free_matches_loser_between_0_and_12"',
  'cas 6h: CHECK perdant entre 0 et 12');
select pg_temp.assert_blocked(
  $sql$ insert into public.free_matches (created_by, score_a, score_b, played_on)
        values ('c1000000-0000-4000-8000-000000000001', 13, 7, (timezone('Europe/Paris', now()))::date + 1) $sql$,
  '23514', 'new row for relation "free_matches" violates check constraint "free_matches_played_on_not_in_future"',
  'cas 6i: CHECK date de jeu');

-- ----------------------------------------------------------------------------
-- Cas 7 — immuabilité : aucune écriture directe, même par le créateur.
-- Privilège absent → 42501 avant toute évaluation RLS.
-- ----------------------------------------------------------------------------

select pg_temp.act_as('c1000000-0000-4000-8000-000000000001');

select pg_temp.assert_blocked(
  $sql$ update public.free_matches set score_a = 12 where id = pg_temp.match_id('M1') $sql$,
  '42501', null, 'cas 7a: UPDATE free_matches par le créateur');
select pg_temp.assert_blocked(
  $sql$ update public.free_match_players set display_name = 'x' where match_id = pg_temp.match_id('M1') $sql$,
  '42501', null, 'cas 7b: UPDATE free_match_players par le créateur');
select pg_temp.assert_blocked(
  $sql$ insert into public.free_matches (created_by, score_a, score_b)
        values ('c1000000-0000-4000-8000-000000000001', 13, 1) $sql$,
  '42501', null, 'cas 7c: INSERT direct free_matches');
select pg_temp.assert_blocked(
  $sql$ insert into public.free_match_players (match_id, side, user_id, display_name)
        values (pg_temp.match_id('M1'), 'A', null, 'intrus') $sql$,
  '42501', null, 'cas 7d: INSERT direct free_match_players');
select pg_temp.assert_blocked(
  $sql$ select count(*) from public.user_free_match_stats $sql$,
  '42501', null, 'cas 7e: user_free_match_stats deny-total');

-- ----------------------------------------------------------------------------
-- Cas 8 — suppression : participant non créateur (U2) et tiers (U4) → 0
-- ligne ; créateur (U1) → 1 ligne, participants en cascade, stats
-- dématérialisées.
-- ----------------------------------------------------------------------------

reset role;
select pg_temp.act_as('c1000000-0000-4000-8000-000000000002');
select pg_temp.assert_row_count(
  $sql$ delete from public.free_matches where id = pg_temp.match_id('M1') $sql$,
  0, 'cas 8a: DELETE par un participant non créateur = no-op');

reset role;
select pg_temp.act_as('c1000000-0000-4000-8000-000000000004');
select pg_temp.assert_row_count(
  $sql$ delete from public.free_matches where id = pg_temp.match_id('M1') $sql$,
  0, 'cas 8b: DELETE par un tiers = no-op');

reset role;
select pg_temp.act_as('c1000000-0000-4000-8000-000000000001');
select pg_temp.assert_row_count(
  $sql$ delete from public.free_matches where id = pg_temp.match_id('M1') $sql$,
  1, 'cas 8c: DELETE par le créateur');

reset role;
select pg_temp.assert_eq_int(
  (select count(*) from public.free_match_players where match_id = pg_temp.match_id('M1')),
  0, 'cas 8d: participants supprimés en cascade');
select pg_temp.assert_free_stats('c1000000-0000-4000-8000-000000000001', 4, 3, 1, 44, 36, 'cas 8: stats U1 sans M1');
select pg_temp.assert_free_stats('c1000000-0000-4000-8000-000000000002', 4, 1, 3, 36, 44, 'cas 8: stats U2 sans M1');

-- ----------------------------------------------------------------------------
-- Cas 9 — visibilité, sur les deux tables. M2 est privé (U1, U2, U3 +
-- 2 libres) ; M6 est public (U1 contre U2, 13-3).
-- ----------------------------------------------------------------------------

select pg_temp.act_as('c1000000-0000-4000-8000-000000000001');
insert into pg_temp.created_matches (label, id)
select 'M6', public.create_free_match(
  null, 'public', 13, 3,
  jsonb_build_array(
    jsonb_build_object('side', 'A', 'user_id', 'c1000000-0000-4000-8000-000000000001'),
    jsonb_build_object('side', 'B', 'user_id', 'c1000000-0000-4000-8000-000000000002')));

reset role;
select pg_temp.act_as('c1000000-0000-4000-8000-000000000002');
select pg_temp.assert_eq_int(
  (select count(*) from public.free_matches where id = pg_temp.match_id('M2')),
  1, 'cas 9a: match privé visible par un participant (U2)');
select pg_temp.assert_eq_int(
  (select count(*) from public.free_match_players where match_id = pg_temp.match_id('M2')),
  6, 'cas 9b: participants du match privé visibles par U2');

reset role;
select pg_temp.act_as('c1000000-0000-4000-8000-000000000003');
select pg_temp.assert_eq_int(
  (select count(*) from public.free_matches where id = pg_temp.match_id('M2')),
  1, 'cas 9c: match privé visible par un autre participant (U3)');

reset role;
select pg_temp.act_as('c1000000-0000-4000-8000-000000000004');
select pg_temp.assert_eq_int(
  (select count(*) from public.free_matches where id = pg_temp.match_id('M2')),
  0, 'cas 9d: match privé invisible pour un tiers (U4)');
select pg_temp.assert_eq_int(
  (select count(*) from public.free_match_players where match_id = pg_temp.match_id('M2')),
  0, 'cas 9e: participants du match privé invisibles pour U4');
select pg_temp.assert_eq_int(
  (select count(*) from public.free_matches where id = pg_temp.match_id('M6')),
  1, 'cas 9f: match public visible par un tiers');
select pg_temp.assert_eq_int(
  (select count(*) from public.free_match_players where match_id = pg_temp.match_id('M6')),
  2, 'cas 9g: participants du match public visibles par un tiers');

reset role;
select pg_temp.assert_free_stats('c1000000-0000-4000-8000-000000000001', 5, 4, 1, 57, 39, 'cas 9: stats U1 avec M6');
select pg_temp.assert_free_stats('c1000000-0000-4000-8000-000000000002', 5, 1, 4, 39, 57, 'cas 9: stats U2 avec M6');

-- ----------------------------------------------------------------------------
-- Cas 13 — garde « compte disparu » de recompute_user_stats. U1 est owner ET
-- joueur du tournoi terminé T1 (contre U4), et participant de M2..M6. Sans la
-- garde, la cascade tournaments (T1) → dématérialisation → recompute(U1) →
-- ré-insertion de stats pour un auth.users déjà supprimé → 23503, suppression
-- annulée (bug latent, démontré hors harnais). Fixtures en postgres.
-- ----------------------------------------------------------------------------

insert into public.tournaments (id, owner_id, name, date, status) values
  ('f5000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'fm-check-T1', current_date, 'draft');
insert into public.teams (id, tournament_id, name) values
  ('a5555555-5555-4555-8555-000000000001', 'f5000000-0000-4000-8000-000000000001', 'Alpha'),
  ('b5555555-5555-4555-8555-000000000001', 'f5000000-0000-4000-8000-000000000001', 'Bravo');
insert into public.team_players (team_id, tournament_id, user_id, display_name) values
  ('a5555555-5555-4555-8555-000000000001', 'f5000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'u1'),
  ('b5555555-5555-4555-8555-000000000001', 'f5000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000004', 'u4');
insert into public.tournament_matches (tournament_id, team_a_id, team_b_id, score_a, score_b, winner_id, status, round_number) values
  ('f5000000-0000-4000-8000-000000000001', 'a5555555-5555-4555-8555-000000000001', 'b5555555-5555-4555-8555-000000000001', 13, 7, 'a5555555-5555-4555-8555-000000000001', 'completed', 1);
update public.tournaments set status = 'in_progress' where id = 'f5000000-0000-4000-8000-000000000001';
update public.tournaments set status = 'completed'   where id = 'f5000000-0000-4000-8000-000000000001';

select pg_temp.assert_eq_int(
  (select count(*) from public.user_tournament_results where user_id = 'c1000000-0000-4000-8000-000000000001'),
  1, 'cas 13: setup — U1 a un résultat de tournoi terminé');
select pg_temp.assert_eq_int(
  (select count(*) from public.user_stats where user_id = 'c1000000-0000-4000-8000-000000000001'),
  1, 'cas 13: setup — U1 a une ligne user_stats');

-- Contournement de l'artefact de transaction unique (cf. en-tête, cas 13) :
-- sans cette ligne, la suppression échouerait ici sur une FK de team_players
-- qui ne pose aucun problème en conditions réelles. Le résultat matérialisé
-- de U1 dans T1 reste en place : la cascade de T1 rappellera bien
-- recompute(U1) alors que ses matchs libres sont encore liés.
delete from public.team_players
 where tournament_id = 'f5000000-0000-4000-8000-000000000001'
   and user_id = 'c1000000-0000-4000-8000-000000000001';

do $$
declare
  v_state text;
  v_msg text;
begin
  delete from auth.users where id = 'c1000000-0000-4000-8000-000000000001';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  raise exception '[cas 13a: suppression du compte U1] ANNULÉE — sqlstate % : %', v_state, v_msg;
end;
$$;

select pg_temp.assert_eq_int(
  (select count(*) from auth.users where id = 'c1000000-0000-4000-8000-000000000001'),
  0, 'cas 13b: compte U1 supprimé');
select pg_temp.assert_eq_int(
  (select count(*) from public.user_stats where user_id = 'c1000000-0000-4000-8000-000000000001')
  + (select count(*) from public.user_free_match_stats where user_id = 'c1000000-0000-4000-8000-000000000001')
  + (select count(*) from public.user_tournament_results where user_id = 'c1000000-0000-4000-8000-000000000001'),
  0, 'cas 13c: plus aucune ligne de stats pour U1');
select pg_temp.assert_eq_int(
  (select count(*) from public.free_matches
    where id in (pg_temp.match_id('M2'), pg_temp.match_id('M3'), pg_temp.match_id('M4'),
                 pg_temp.match_id('M5'), pg_temp.match_id('M6'))),
  5, 'cas 13d: les matchs de U1 survivent (S7)');
select pg_temp.assert_eq_int(
  (select count(*) from public.free_match_players p
     join pg_temp.fixture_profile f on f.id = 'c1000000-0000-4000-8000-000000000001'
    where p.user_id is null and p.display_name = f.display_name),
  5, 'cas 13e: U1 détaché de ses 5 matchs, pseudo conservé');
select pg_temp.assert_eq_int(
  (select count(*) from public.free_matches where created_by = 'c1000000-0000-4000-8000-000000000001'),
  0, 'cas 13f: créateur détaché (R2)');
select pg_temp.assert_free_stats('c1000000-0000-4000-8000-000000000002', 5, 1, 4, 39, 57, 'cas 13g: stats U2 inchangées');
select pg_temp.assert_free_stats('c1000000-0000-4000-8000-000000000003', 1, 0, 1, 11, 13, 'cas 13h: stats U3 inchangées');
select pg_temp.assert_eq_int(
  (select count(*) from public.tournaments where id = 'f5000000-0000-4000-8000-000000000001'),
  0, 'cas 13i: tournoi de U1 supprimé en cascade (comportement existant)');

-- ----------------------------------------------------------------------------
-- Cas 10 — S7 : suppression du compte U2. M2 (U3 encore lié) survit, la ligne
-- de U2 garde son pseudo ; les stats de U3 sont inchangées ; celles de U2
-- disparaissent. M3..M6 n'avaient plus que U2 comme compte : S8 les supprime.
-- ----------------------------------------------------------------------------

delete from auth.users where id = 'c1000000-0000-4000-8000-000000000002';

select pg_temp.assert_eq_int(
  (select count(*) from public.free_matches where id = pg_temp.match_id('M2')),
  1, 'cas 10a: le match avec un autre compte survit (S7)');
select pg_temp.assert_eq_int(
  (select count(*) from public.free_match_players p
     join pg_temp.fixture_profile f on f.id = 'c1000000-0000-4000-8000-000000000002'
    where p.match_id = pg_temp.match_id('M2') and p.side = 'B'
      and p.user_id is null and p.display_name = f.display_name),
  1, 'cas 10b: ligne de U2 détachée, pseudo conservé');
select pg_temp.assert_free_stats('c1000000-0000-4000-8000-000000000003', 1, 0, 1, 11, 13, 'cas 10c: stats U3 inchangées');
select pg_temp.assert_eq_int(
  (select count(*) from public.user_free_match_stats where user_id = 'c1000000-0000-4000-8000-000000000002'),
  0, 'cas 10d: stats de U2 disparues (cascade)');
select pg_temp.assert_eq_int(
  (select count(*) from public.free_matches
    where id in (pg_temp.match_id('M3'), pg_temp.match_id('M4'), pg_temp.match_id('M5'), pg_temp.match_id('M6'))),
  0, 'cas 10e: matchs sans plus aucun compte supprimés (S8)');

-- ----------------------------------------------------------------------------
-- Cas 11 — S8 : U3 était le dernier compte de M2.
-- ----------------------------------------------------------------------------

delete from auth.users where id = 'c1000000-0000-4000-8000-000000000003';

select pg_temp.assert_eq_int((select count(*) from public.free_matches), 0,
  'cas 11a: dernier compte disparu → match supprimé');
select pg_temp.assert_eq_int((select count(*) from public.free_match_players), 0,
  'cas 11b: participants supprimés en cascade');
select pg_temp.assert_eq_int((select count(*) from public.user_free_match_stats), 0,
  'cas 11c: plus aucune ligne de stats de match libre');

select 'free_match_check: OK — 13 cas verts (le cas 12 = harnais existants rejoués séparément)' as result;

rollback;
