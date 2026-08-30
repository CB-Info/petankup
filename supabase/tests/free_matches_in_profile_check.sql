-- ============================================================================
-- free_matches_in_profile_check.sql — vérification manuelle des matchs libres
-- dans le bundle de profil (migration 20260831100000_free_matches_in_profile).
--
-- HORS CI : à exécuter à la main dans le SQL Editor de Supabase Studio (ou
-- psql sur la stack locale). Tout est encadré par begin/rollback : aucune
-- ligne ne reste en base. Si une assertion échoue, un raise exception
-- interrompt le script — la transaction avortée annule tout de toute façon.
--
-- Sémantique attendue (cf. en-tête de la migration) :
--   - free_matches : une entrée par match libre du joueur consulté, triée
--     played_on desc, created_at desc, id desc ; [] sans match.
--   - viewer_can_open : calculé pour l'APPELANT (helper partagé H2.a) ;
--     quand il est faux, teammates et opponents sont [] (décision
--     « divulgation ») — date, scores et camp restent présents.
--   - free_match_stats : compteurs tels quels, null sans match libre.
--   - Ajout strict : profile, stats, results inchangés (clés et valeurs).
--
-- Parité d'environnement : AUCUN bloc GRANT sur les tables du schéma. Seules
-- les tables pg_temp du harnais reçoivent un grant à authenticated pour être
-- lisibles sous identité simulée (précédent find_account_check).
--
-- Simulation d'identité : pg_temp.act_as(<user>) pose request.jwt.claims
-- (set_config transaction-local, traverse les DEFINER : auth.uid() = le user
-- simulé) puis set local role authenticated ; reset role rend la main à
-- postgres pour les fixtures et les corrections de contrôle.
--
-- Décor : U1 (joueur consulté), U2 et U3 (participants à compte), U4 (tiers,
-- jamais participant d'un match libre). Les pseudos des profils (créés par
-- trigger depuis l'email) sont capturés dans pg_temp.fixture_profile — D.1
-- peut suffixer un pseudo en collision, on ne compare jamais à une constante.
-- Tri des joueurs : les emails donnent des pseudos « fmp-u… » et les joueurs
-- libres sont nommés en minuscules (albert, zoe, bob, carl) pour que leur
-- ordre relatif soit le même quelle que soit la collation de la base (C ou
-- en_US.UTF-8) ; les payloads listent les joueurs dans l'ordre INVERSE du tri
-- attendu, pour que les assertions d'ordre discriminent.
--   T1 : tournoi public de U1, terminé (Alpha = U1 + « libre » / Bravo = U2,
--        13-5) — non-régression du journal des tournois.
--   M1 : privé, 2026-08-10, [A] U1 + albert / [B] zoe + U3, 13-7 (U1 gagne).
--   M2 : public, 2026-08-20, [A] U2 / [B] U1, 9-13 (U1 gagne, en B).
--   M3 : privé, 2026-08-20, [A] U1 + U2 / [B] carl + bob, 5-13 (U1 perd).
--   Stats libres attendues : U1 (3, 2, 1, 31, 29), U2 (2, 0, 2, 14, 26),
--   U3 (1, 0, 1, 7, 13).
--   ⚠️ Artefact de transaction unique : now() est figé au début de la
--   transaction, donc les trois created_at sont identiques et le départage
--   « created_at desc » entre M2 et M3 (même jour) serait inerte. Pour
--   l'éprouver réellement, M2 est reculé d'une heure en postgres après sa
--   création (le propriétaire contourne RLS et privilèges ; seul le trigger
--   set_updated_at tire, sans effet sur le bundle).
--
-- Cas (numérotation du ticket H2.c-1 §4) :
--   1  U1 a des matchs libres : 3 entrées, ordre M3, M2, M1 ; dates, scores,
--      camp (M2 : side = 'B').
--   2  coéquipiers et adversaires, avec des joueurs sans compte, triés par
--      pseudo, le joueur consulté exclu de ses coéquipiers.
--   3  match public consulté par un tiers (U4) → ouvrable.
--   4  matchs privés dont U4 n'est pas participant → non ouvrables, listes
--      vides, date / scores / camp présents.
--   5  match privé auquel le visiteur a participé (U3 sur M1, U2 sur M3) →
--      ouvrable ; M1 reste fermé à U2.
--   6  U1 sur son propre profil → tout ouvrable.
--   7  free_match_stats cohérentes avec les matchs enregistrés, quel que
--      soit le visiteur.
--   8  joueur sans aucun match libre (U4) : [] et null, sans erreur.
--   9  non-régression : clés de premier niveau dans l'ordre, clés de stats
--      et d'une entrée de journal inchangées, valeurs du tournoi T1,
--      not_authenticated sans identité.
--   10 non-régression : viewer_can_open_check, free_match_check,
--      find_account_check, tournament_freeze_check et ranking_fixtures_check
--      sont rejoués SÉPARÉMENT (fichiers autonomes).
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

-- Clés d'un objet json, DANS L'ORDRE du document (json, pas jsonb),
-- comparées à la séquence attendue : vérifie l'ensemble ET l'ordre.
create function pg_temp.assert_keys(
  p_object json,
  p_expected text[],
  p_label text
) returns void
language plpgsql
as $$
declare
  v_actual text[];
begin
  select coalesce(array_agg(key order by ordinality), '{}'::text[])
    into v_actual
    from json_object_keys(p_object) with ordinality as keys(key, ordinality);
  if v_actual is distinct from p_expected then
    raise exception '[%] clés attendues %, obtenues %', p_label, p_expected, v_actual;
  end if;
end;
$$;

-- Séquence des display_name d'un tableau json de joueurs, dans l'ordre du
-- document, comparée à la séquence attendue.
create function pg_temp.assert_names(
  p_players json,
  p_expected text[],
  p_label text
) returns void
language plpgsql
as $$
declare
  v_actual text[];
begin
  select coalesce(array_agg(player->>'display_name' order by ordinality), '{}'::text[])
    into v_actual
    from json_array_elements(p_players) with ordinality as players(player, ordinality);
  if v_actual is distinct from p_expected then
    raise exception '[%] joueurs attendus %, obtenus %', p_label, p_expected, v_actual;
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

-- Bundle du profil consulté, vu par l'identité simulée courante.
create function pg_temp.bundle(p_profile uuid) returns json
language sql
as $$
  select public.get_user_profile(p_profile);
$$;

-- Entrée free_matches d'un match donné dans le bundle d'un profil (null si
-- absente).
create function pg_temp.free_match_entry(p_profile uuid, p_match uuid) returns json
language sql
as $$
  select entry
    from json_array_elements(public.get_user_profile(p_profile)->'free_matches') entry
   where entry->>'match_id' = p_match::text;
$$;

-- Miroir de assert_can_open (viewer_can_open_check) pour les matchs libres.
create function pg_temp.assert_fm_can_open(
  p_profile uuid,
  p_match uuid,
  p_expected boolean,
  p_label text
) returns void
language plpgsql
as $$
declare
  v_actual boolean;
begin
  select (pg_temp.free_match_entry(p_profile, p_match)->>'viewer_can_open')::boolean
    into v_actual;
  if v_actual is null then
    raise exception '[%] aucune entrée de journal pour le match %', p_label, p_match;
  end if;
  if v_actual is distinct from p_expected then
    raise exception '[%] viewer_can_open attendu %, obtenu %', p_label, p_expected, v_actual;
  end if;
end;
$$;

-- Compare l'objet free_match_stats d'un bundle (lecture via le bundle, pas
-- la table : c'est le contrat de la fonction qui est vérifié).
create function pg_temp.assert_free_stats_json(
  p_stats json,
  p_played int, p_wins int, p_losses int, p_scored int, p_conceded int,
  p_label text
) returns void
language plpgsql
as $$
begin
  if p_stats is null or json_typeof(p_stats) = 'null' then
    raise exception '[%] free_match_stats absent', p_label;
  end if;
  if ((p_stats->>'matches_played')::int, (p_stats->>'wins')::int, (p_stats->>'losses')::int,
      (p_stats->>'points_scored')::int, (p_stats->>'points_conceded')::int)
     is distinct from (p_played, p_wins, p_losses, p_scored, p_conceded) then
    raise exception '[%] stats attendues (joués %, V %, D %, marqués %, encaissés %), obtenues %',
      p_label, p_played, p_wins, p_losses, p_scored, p_conceded, p_stats::text;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- Fixtures (en postgres). Le trigger handle_new_user_profile crée les profils.
-- ----------------------------------------------------------------------------

insert into auth.users (id, email, aud, role, created_at, updated_at) values
  ('c3000000-0000-4000-8000-000000000001', 'fmp-u1@petankup.test', 'authenticated', 'authenticated', now(), now()),
  ('c3000000-0000-4000-8000-000000000002', 'fmp-u2@petankup.test', 'authenticated', 'authenticated', now(), now()),
  ('c3000000-0000-4000-8000-000000000003', 'fmp-u3@petankup.test', 'authenticated', 'authenticated', now(), now()),
  ('c3000000-0000-4000-8000-000000000004', 'fmp-u4@petankup.test', 'authenticated', 'authenticated', now(), now());

create table pg_temp.fixture_profile as
  select id, display_name from public.profiles
   where id in ('c3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002',
                'c3000000-0000-4000-8000-000000000003', 'c3000000-0000-4000-8000-000000000004');
grant select on table pg_temp.fixture_profile to authenticated;

select pg_temp.assert_eq_int((select count(*) from pg_temp.fixture_profile), 4, 'setup: 4 profils créés');

create function pg_temp.pseudo(p_user uuid) returns text
language sql
as $$
  select display_name from pg_temp.fixture_profile where id = p_user;
$$;

-- T1 : tournoi public de U1, Alpha (U1 + un joueur libre) bat Bravo (U2)
-- 13-5, puis complétion par le chemin de production (trigger de
-- matérialisation → user_tournament_results / user_stats).
insert into public.tournaments (id, owner_id, name, date, status, visibility) values
  ('f3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 'fmp-tournoi', current_date, 'draft', 'public');

insert into public.teams (id, tournament_id, name) values
  ('a3333333-3333-4333-8333-000000000001', 'f3000000-0000-4000-8000-000000000001', 'Alpha'),
  ('b3333333-3333-4333-8333-000000000001', 'f3000000-0000-4000-8000-000000000001', 'Bravo');

insert into public.team_players (team_id, tournament_id, user_id, display_name) values
  ('a3333333-3333-4333-8333-000000000001', 'f3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', pg_temp.pseudo('c3000000-0000-4000-8000-000000000001')),
  ('a3333333-3333-4333-8333-000000000001', 'f3000000-0000-4000-8000-000000000001', null, 'libre'),
  ('b3333333-3333-4333-8333-000000000001', 'f3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', pg_temp.pseudo('c3000000-0000-4000-8000-000000000002'));

insert into public.tournament_matches (tournament_id, team_a_id, team_b_id, score_a, score_b, winner_id, status, round_number) values
  ('f3000000-0000-4000-8000-000000000001', 'a3333333-3333-4333-8333-000000000001', 'b3333333-3333-4333-8333-000000000001', 13, 5, 'a3333333-3333-4333-8333-000000000001', 'completed', 1);

update public.tournaments set status = 'completed'
 where id = 'f3000000-0000-4000-8000-000000000001';

-- Matchs libres, créés par U1 via la RPC (chemin de production : stats
-- matérialisées par trigger). Joueurs listés dans l'ordre inverse du tri.
select pg_temp.act_as('c3000000-0000-4000-8000-000000000001');

insert into pg_temp.created_matches (label, id)
select 'M1', public.create_free_match(
  '2026-08-10', 'private', 13, 7,
  jsonb_build_array(
    jsonb_build_object('side', 'A', 'user_id', 'c3000000-0000-4000-8000-000000000001'),
    jsonb_build_object('side', 'A', 'user_id', null, 'display_name', 'albert'),
    jsonb_build_object('side', 'B', 'user_id', null, 'display_name', 'zoe'),
    jsonb_build_object('side', 'B', 'user_id', 'c3000000-0000-4000-8000-000000000003')
  ));

insert into pg_temp.created_matches (label, id)
select 'M2', public.create_free_match(
  '2026-08-20', 'public', 9, 13,
  jsonb_build_array(
    jsonb_build_object('side', 'A', 'user_id', 'c3000000-0000-4000-8000-000000000002'),
    jsonb_build_object('side', 'B', 'user_id', 'c3000000-0000-4000-8000-000000000001')
  ));

insert into pg_temp.created_matches (label, id)
select 'M3', public.create_free_match(
  '2026-08-20', 'private', 5, 13,
  jsonb_build_array(
    jsonb_build_object('side', 'A', 'user_id', 'c3000000-0000-4000-8000-000000000001'),
    jsonb_build_object('side', 'A', 'user_id', 'c3000000-0000-4000-8000-000000000002'),
    jsonb_build_object('side', 'B', 'user_id', null, 'display_name', 'carl'),
    jsonb_build_object('side', 'B', 'user_id', null, 'display_name', 'bob')
  ));

reset role;
select pg_temp.assert_eq_int((select count(*) from pg_temp.created_matches), 3, 'setup: 3 matchs créés');

-- Départage réel entre M2 et M3 (même jour) : cf. artefact en en-tête.
update public.free_matches
   set created_at = created_at - interval '1 hour'
 where id = pg_temp.match_id('M2');

-- ----------------------------------------------------------------------------
-- Cas 1 — U1 consulte son profil : trois entrées, ordre M3, M2, M1, avec
-- dates, scores et camp.
-- ----------------------------------------------------------------------------

select pg_temp.act_as('c3000000-0000-4000-8000-000000000001');

select pg_temp.assert_eq_int(
  json_array_length(pg_temp.bundle('c3000000-0000-4000-8000-000000000001')->'free_matches'),
  3, 'cas 1a: trois matchs libres');
select pg_temp.assert_eq_text(
  pg_temp.bundle('c3000000-0000-4000-8000-000000000001')->'free_matches'->0->>'match_id',
  pg_temp.match_id('M3')::text, 'cas 1b: M3 en tête (même jour que M2, créé après)');
select pg_temp.assert_eq_text(
  pg_temp.bundle('c3000000-0000-4000-8000-000000000001')->'free_matches'->1->>'match_id',
  pg_temp.match_id('M2')::text, 'cas 1c: M2 en deuxième');
select pg_temp.assert_eq_text(
  pg_temp.bundle('c3000000-0000-4000-8000-000000000001')->'free_matches'->2->>'match_id',
  pg_temp.match_id('M1')::text, 'cas 1d: M1 en dernier (date antérieure)');

do $$
declare
  v_m1 json := pg_temp.free_match_entry('c3000000-0000-4000-8000-000000000001', pg_temp.match_id('M1'));
  v_m2 json := pg_temp.free_match_entry('c3000000-0000-4000-8000-000000000001', pg_temp.match_id('M2'));
  v_m3 json := pg_temp.free_match_entry('c3000000-0000-4000-8000-000000000001', pg_temp.match_id('M3'));
begin
  perform pg_temp.assert_keys(v_m1,
    array['match_id', 'played_on', 'created_at', 'score_a', 'score_b', 'side',
          'viewer_can_open', 'teammates', 'opponents'],
    'cas 1e: clés d''une entrée de match libre');
  perform pg_temp.assert_eq_text(v_m1->>'played_on', '2026-08-10', 'cas 1f: date de M1');
  perform pg_temp.assert_eq_int((v_m1->>'score_a')::int, 13, 'cas 1g: score A de M1');
  perform pg_temp.assert_eq_int((v_m1->>'score_b')::int, 7, 'cas 1h: score B de M1');
  perform pg_temp.assert_eq_text(v_m1->>'side', 'A', 'cas 1i: camp de U1 dans M1');
  perform pg_temp.assert_eq_text(v_m2->>'played_on', '2026-08-20', 'cas 1j: date de M2');
  perform pg_temp.assert_eq_text(v_m2->>'side', 'B', 'cas 1k: camp de U1 dans M2 (B)');
  perform pg_temp.assert_eq_int((v_m2->>'score_a')::int, 9, 'cas 1l: score A de M2');
  perform pg_temp.assert_eq_int((v_m2->>'score_b')::int, 13, 'cas 1m: score B de M2');
  perform pg_temp.assert_eq_text(v_m3->>'side', 'A', 'cas 1n: camp de U1 dans M3');
  perform pg_temp.assert_eq_int((v_m3->>'score_a')::int, 5, 'cas 1o: score A de M3');
  if (v_m3->>'created_at')::timestamptz <= (v_m2->>'created_at')::timestamptz then
    raise exception '[cas 1p] created_at exposé : M3 (%) devrait suivre M2 (%)',
      v_m3->>'created_at', v_m2->>'created_at';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- Cas 2 — coéquipiers et adversaires (U1, participant : listes complètes),
-- joueurs sans compte inclus, tri par pseudo, U1 exclu de ses coéquipiers.
-- ----------------------------------------------------------------------------

do $$
declare
  v_m1 json := pg_temp.free_match_entry('c3000000-0000-4000-8000-000000000001', pg_temp.match_id('M1'));
  v_m2 json := pg_temp.free_match_entry('c3000000-0000-4000-8000-000000000001', pg_temp.match_id('M2'));
  v_m3 json := pg_temp.free_match_entry('c3000000-0000-4000-8000-000000000001', pg_temp.match_id('M3'));
begin
  perform pg_temp.assert_names(v_m1->'teammates', array['albert'], 'cas 2a: coéquipier libre de M1, U1 exclu');
  if json_typeof(v_m1->'teammates'->0->'user_id') <> 'null' then
    raise exception '[cas 2b] albert est un joueur libre : user_id doit être null';
  end if;
  perform pg_temp.assert_names(v_m1->'opponents',
    array[pg_temp.pseudo('c3000000-0000-4000-8000-000000000003'), 'zoe'],
    'cas 2c: adversaires de M1 triés par pseudo (compte puis libre)');
  perform pg_temp.assert_eq_text(v_m1->'opponents'->0->>'user_id',
    'c3000000-0000-4000-8000-000000000003', 'cas 2d: U3 porte son identifiant de compte');
  perform pg_temp.assert_names(v_m2->'teammates', '{}'::text[], 'cas 2e: U1 seul dans son camp de M2');
  perform pg_temp.assert_names(v_m2->'opponents',
    array[pg_temp.pseudo('c3000000-0000-4000-8000-000000000002')], 'cas 2f: adversaire de M2');
  perform pg_temp.assert_names(v_m3->'teammates',
    array[pg_temp.pseudo('c3000000-0000-4000-8000-000000000002')], 'cas 2g: coéquipier à compte de M3');
  perform pg_temp.assert_names(v_m3->'opponents', array['bob', 'carl'],
    'cas 2h: adversaires libres de M3 triés (payload carl, bob)');
end;
$$;

-- ----------------------------------------------------------------------------
-- Cas 3 — match public consulté par un tiers (U4) → ouvrable.
-- ----------------------------------------------------------------------------

reset role;
select pg_temp.act_as('c3000000-0000-4000-8000-000000000004');

select pg_temp.assert_fm_can_open('c3000000-0000-4000-8000-000000000001', pg_temp.match_id('M2'),
  true, 'cas 3: match public ouvrable par un tiers');

-- ----------------------------------------------------------------------------
-- Cas 4 — matchs privés dont U4 n'est pas participant → non ouvrables ;
-- listes vides, date / scores / camp présents.
-- ----------------------------------------------------------------------------

select pg_temp.assert_fm_can_open('c3000000-0000-4000-8000-000000000001', pg_temp.match_id('M1'),
  false, 'cas 4a: match privé fermé à un tiers');
select pg_temp.assert_fm_can_open('c3000000-0000-4000-8000-000000000001', pg_temp.match_id('M3'),
  false, 'cas 4b: second match privé fermé à un tiers');

do $$
declare
  v_m1 json := pg_temp.free_match_entry('c3000000-0000-4000-8000-000000000001', pg_temp.match_id('M1'));
  v_m3 json := pg_temp.free_match_entry('c3000000-0000-4000-8000-000000000001', pg_temp.match_id('M3'));
begin
  perform pg_temp.assert_names(v_m1->'teammates', '{}'::text[], 'cas 4c: coéquipiers de M1 masqués à un tiers');
  perform pg_temp.assert_names(v_m1->'opponents', '{}'::text[], 'cas 4d: adversaires de M1 masqués à un tiers');
  perform pg_temp.assert_names(v_m3->'teammates', '{}'::text[], 'cas 4e: coéquipiers de M3 masqués à un tiers');
  perform pg_temp.assert_names(v_m3->'opponents', '{}'::text[], 'cas 4f: adversaires de M3 masqués à un tiers');
  perform pg_temp.assert_eq_text(v_m1->>'played_on', '2026-08-10', 'cas 4g: date de M1 toujours présente');
  perform pg_temp.assert_eq_int((v_m1->>'score_a')::int, 13, 'cas 4h: score de M1 toujours présent');
  perform pg_temp.assert_eq_text(v_m1->>'side', 'A', 'cas 4i: camp de U1 toujours présent');
  perform pg_temp.assert_eq_int(
    json_array_length(pg_temp.bundle('c3000000-0000-4000-8000-000000000001')->'free_matches'),
    3, 'cas 4j: les trois matchs restent listés (journal sans gate)');
end;
$$;

-- ----------------------------------------------------------------------------
-- Cas 5 — match privé auquel le visiteur a participé → ouvrable (listes
-- complètes) ; M1 reste fermé à U2 (non participant).
-- ----------------------------------------------------------------------------

reset role;
select pg_temp.act_as('c3000000-0000-4000-8000-000000000003');
select pg_temp.assert_fm_can_open('c3000000-0000-4000-8000-000000000001', pg_temp.match_id('M1'),
  true, 'cas 5a: U3, participant de M1, peut l''ouvrir');
select pg_temp.assert_names(
  pg_temp.free_match_entry('c3000000-0000-4000-8000-000000000001', pg_temp.match_id('M1'))->'opponents',
  array[pg_temp.pseudo('c3000000-0000-4000-8000-000000000003'), 'zoe'],
  'cas 5b: U3 voit les adversaires de U1 dans M1 (lui-même inclus)');

reset role;
select pg_temp.act_as('c3000000-0000-4000-8000-000000000002');
select pg_temp.assert_fm_can_open('c3000000-0000-4000-8000-000000000001', pg_temp.match_id('M3'),
  true, 'cas 5c: U2, participant de M3, peut l''ouvrir');
select pg_temp.assert_names(
  pg_temp.free_match_entry('c3000000-0000-4000-8000-000000000001', pg_temp.match_id('M3'))->'opponents',
  array['bob', 'carl'], 'cas 5d: U2 voit les adversaires de M3');
select pg_temp.assert_fm_can_open('c3000000-0000-4000-8000-000000000001', pg_temp.match_id('M1'),
  false, 'cas 5e: M1 reste fermé à U2');

-- ----------------------------------------------------------------------------
-- Cas 6 — U1 sur son propre profil : tout ouvrable.
-- ----------------------------------------------------------------------------

reset role;
select pg_temp.act_as('c3000000-0000-4000-8000-000000000001');
select pg_temp.assert_fm_can_open('c3000000-0000-4000-8000-000000000001', pg_temp.match_id('M1'), true, 'cas 6a: propre profil, M1');
select pg_temp.assert_fm_can_open('c3000000-0000-4000-8000-000000000001', pg_temp.match_id('M2'), true, 'cas 6b: propre profil, M2');
select pg_temp.assert_fm_can_open('c3000000-0000-4000-8000-000000000001', pg_temp.match_id('M3'), true, 'cas 6c: propre profil, M3');

-- ----------------------------------------------------------------------------
-- Cas 7 — free_match_stats cohérentes avec les matchs enregistrés, quel que
-- soit le visiteur (U4, tiers).
-- ----------------------------------------------------------------------------

reset role;
select pg_temp.act_as('c3000000-0000-4000-8000-000000000004');
select pg_temp.assert_free_stats_json(
  pg_temp.bundle('c3000000-0000-4000-8000-000000000001')->'free_match_stats',
  3, 2, 1, 31, 29, 'cas 7a: stats libres de U1');
select pg_temp.assert_free_stats_json(
  pg_temp.bundle('c3000000-0000-4000-8000-000000000002')->'free_match_stats',
  2, 0, 2, 14, 26, 'cas 7b: stats libres de U2');
select pg_temp.assert_free_stats_json(
  pg_temp.bundle('c3000000-0000-4000-8000-000000000003')->'free_match_stats',
  1, 0, 1, 7, 13, 'cas 7c: stats libres de U3');
select pg_temp.assert_keys(
  pg_temp.bundle('c3000000-0000-4000-8000-000000000001')->'free_match_stats',
  array['matches_played', 'wins', 'losses', 'points_scored', 'points_conceded'],
  'cas 7d: clés de free_match_stats');

-- ----------------------------------------------------------------------------
-- Cas 8 — joueur sans aucun match libre (U4 sur son profil) : [] et null,
-- sans erreur ; le reste du bundle vide comme avant.
-- ----------------------------------------------------------------------------

do $$
declare
  v_bundle json := pg_temp.bundle('c3000000-0000-4000-8000-000000000004');
begin
  perform pg_temp.assert_eq_int(json_array_length(v_bundle->'free_matches'), 0, 'cas 8a: free_matches vide');
  perform pg_temp.assert_eq_text(json_typeof(v_bundle->'free_match_stats'), 'null', 'cas 8b: free_match_stats null');
  perform pg_temp.assert_eq_int(json_array_length(v_bundle->'results'), 0, 'cas 8c: results vide (inchangé)');
  perform pg_temp.assert_eq_text(json_typeof(v_bundle->'stats'), 'null', 'cas 8d: stats null (inchangé)');
  perform pg_temp.assert_eq_text(v_bundle->'profile'->>'display_name',
    pg_temp.pseudo('c3000000-0000-4000-8000-000000000004'), 'cas 8e: profil présent');
end;
$$;

-- ----------------------------------------------------------------------------
-- Cas 9 — non-régression : tout ce que la fonction renvoyait déjà est
-- inchangé (U4 consulte U1).
-- ----------------------------------------------------------------------------

do $$
declare
  v_bundle json := pg_temp.bundle('c3000000-0000-4000-8000-000000000001');
  v_t1 json;
begin
  perform pg_temp.assert_keys(v_bundle,
    array['profile', 'stats', 'results', 'free_matches', 'free_match_stats'],
    'cas 9a: clés de premier niveau, dans l''ordre (les trois existantes d''abord)');
  perform pg_temp.assert_keys(v_bundle->'profile',
    array['id', 'display_name', 'created_at', 'updated_at'],
    'cas 9b: clés de profile inchangées');
  perform pg_temp.assert_keys(v_bundle->'stats',
    array['matches_played', 'wins', 'losses', 'points_scored', 'points_conceded',
          'tournaments_played', 'tournaments_won', 'podiums', 'last_tournament_at'],
    'cas 9c: clés de stats inchangées');
  perform pg_temp.assert_eq_int(json_array_length(v_bundle->'results'), 1, 'cas 9d: un tournoi au journal');
  v_t1 := v_bundle->'results'->0;
  perform pg_temp.assert_keys(v_t1,
    array['tournament_id', 'tournament_name', 'tournament_date', 'tournament_completed_at',
          'team_id', 'team_name', 'wins', 'losses', 'points_scored', 'points_conceded',
          'final_rank', 'is_winner', 'is_podium', 'viewer_can_open', 'teammates'],
    'cas 9e: clés d''une entrée de journal de tournoi inchangées');
  perform pg_temp.assert_eq_text(v_bundle->'profile'->>'display_name',
    pg_temp.pseudo('c3000000-0000-4000-8000-000000000001'), 'cas 9f: pseudo du profil');
  perform pg_temp.assert_eq_int((v_bundle->'stats'->>'tournaments_played')::int, 1, 'cas 9g: tournois joués');
  perform pg_temp.assert_eq_int((v_bundle->'stats'->>'matches_played')::int, 1, 'cas 9h: matchs de tournoi joués (hors matchs libres)');
  perform pg_temp.assert_eq_int((v_bundle->'stats'->>'wins')::int, 1, 'cas 9i: victoires de tournoi');
  perform pg_temp.assert_eq_text(v_t1->>'tournament_name', 'fmp-tournoi', 'cas 9j: nom du tournoi');
  perform pg_temp.assert_eq_text(v_t1->>'viewer_can_open', 'true', 'cas 9k: tournoi public ouvrable par U4');
  perform pg_temp.assert_eq_text(v_t1->>'is_winner', 'true', 'cas 9l: U1 vainqueur de T1');
  perform pg_temp.assert_names(v_t1->'teammates', array['libre'], 'cas 9m: coéquipier libre de T1');
end;
$$;

-- Sans identité → not_authenticated (gate inchangée). Les claims posées par
-- act_as persistent dans la transaction : on les vide explicitement.
reset role;
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select pg_temp.assert_blocked(
  $sql$ select public.get_user_profile('c3000000-0000-4000-8000-000000000001') $sql$,
  'P0001', 'not_authenticated', 'cas 9n: sans identité');
reset role;

-- ----------------------------------------------------------------------------
-- Récapitulatif lisible : le journal libre de U1 vu par un tiers (U4).
-- ----------------------------------------------------------------------------

select pg_temp.act_as('c3000000-0000-4000-8000-000000000004');
select
  entry->>'played_on'        as played_on,
  entry->>'side'             as side,
  entry->>'score_a'          as score_a,
  entry->>'score_b'          as score_b,
  entry->>'viewer_can_open'  as viewer_can_open,
  json_array_length(entry->'teammates') as teammates,
  json_array_length(entry->'opponents') as opponents
from json_array_elements(pg_temp.bundle('c3000000-0000-4000-8000-000000000001')->'free_matches') entry;
reset role;

select 'free_matches_in_profile_check: OK — 9 cas verts (le cas 10 = harnais existants rejoués séparément)' as result;

rollback;
