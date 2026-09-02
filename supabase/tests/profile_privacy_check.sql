-- ============================================================================
-- profile_privacy_check.sql — vérification manuelle de la confidentialité du
-- profil (migration 20260902100000_profile_privacy).
--
-- REMPLACE profile_visibility_check.sql, dont la règle (« avoir joué
-- ensemble » ouvre le profil) est supprimée par cette migration — première
-- suppression de harnais du dépôt, assumée : le fichier entier testait la
-- règle morte ; ses cas encore porteurs de valeur sont repris ici (pseudo à
-- jour post-rename → cas 2 ; soi-même → cas 4-5 ; update self → cas 11).
--
-- HORS CI : à exécuter à la main dans le SQL Editor de Supabase Studio (ou
-- psql sur la stack locale). Tout est encadré par begin/rollback : aucune
-- ligne ne reste en base. Si une assertion échoue, un raise exception
-- interrompt le script — la transaction avortée annule tout de toute façon.
--
-- Modèle éprouvé (A2) : la page est ouverte à tout authentifié ; le CONTENU
-- est protégé EN BASE — bundle complet si profil public OU appelant ami OU
-- propriétaire, sinon { profile, restricted: true } : le pseudo seul, les
-- clés stats/results/free_matches/free_match_stats ABSENTES (jamais
-- calculées). Le pseudo est public à l'échelle du produit
-- (find_account_by_display_name le résout déjà) : seul le contenu se
-- protège.
--
-- Parité d'environnement : AUCUN grant posé sur les tables du schéma (les
-- grants par colonne de profiles viennent de la migration, sur tous les
-- environnements) ; seules les tables pg_temp reçoivent un grant.
--
-- Assertions CIBLÉES par id de fixture, jamais de count global : la base
-- hébergée contient des profils réels.
--
-- Décor (préfixe uuid d2, tournoi f7 — libres) :
--   U1 public (défaut), un match libre public M2 (U1 + libre « Odette »).
--   U2 PRIVÉ (basculé après les fixtures), RENOMMÉ après ses matchs (le
--      pseudo figé des matchs diffère du pseudo à jour) ; M1 match libre
--      PUBLIC U2 vs U4 (13-7) ; M3 match libre PRIVÉ U2 + libre « Marcel »
--      (13-5) ; T1 tournoi brouillon dont U2 est owner et U4 membre.
--   U3 AMI de U2 (via les RPC A1 : demande + acceptation).
--   U4 co-tournoi (T1) ET co-match (M1) de U2, PAS ami — le duo qui prouve
--      la suppression des DEUX branches de l'ancienne règle.
--   U5 inconnu total.
--
-- Cas (numérotation du ticket A2 §6 ; le cas 13 « non-régression » = les 8
-- harnais existants rejoués SÉPARÉMENT, fichiers autonomes) :
--   1  public / non-ami → contenu complet (5 clés, entrées réelles).
--   2  privé / non-ami → { profile, restricted } EXACTEMENT (clés de
--      contenu ABSENTES) ; le pseudo est celui À JOUR, pas le figé.
--   3  privé / ami → contenu complet.
--   4  privé / soi-même → contenu complet.
--   5  public / soi-même → contenu complet.
--   6  co-tournoi ET co-match, non amis, privé → restreint (les deux
--      branches de l'ancienne règle sont mortes).
--   7  deux inconnus, public → complet ; preuve TABLE de l'ouverture :
--      l'inconnu lit les 5 lignes de fixtures (l'ancienne policy n'en
--      aurait montré qu'une).
--   8  une demande en attente n'ouvre PAS le contenu.
--   9  accepter ouvre ; retirer re-masque.
--   10 id inexistant → forme historique (5 clés, profile null, SANS
--      marqueur) — les trois formes sont deux à deux distinguables.
--   11 chacun ne modifie que son réglage (et son pseudo — couverture
--      héritée de l'ancien harnais) ; anon bloqué.
--   12 le contenu autorisé est identique à avant (forme du bundle, clés
--      d'une entrée) ; not_authenticated / anon sur la RPC.
--   F  cas FRONTIÈRE (arbitrage du 2026-09-02, R6 de la spec) : la
--      confidentialité protège l'AGRÉGAT — la participation d'un profil
--      privé à un match PUBLIC reste lisible en direct (modèle de
--      visibilité des objets, inchangé), celle d'un match PRIVÉ non ; la
--      colonne visibility n'est PAS lisible en direct (grant par colonne) ;
--      anon ne lit rien.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- Helpers d'assertion (pg_temp : jetés au rollback / fin de session) —
-- hérités verbatim de free_matches_in_profile_check / find_account_check /
-- tournament_freeze_check / friendship_check.
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

-- « <status>/<requester_id> » — contrôle d'amitié en postgres (deny-total).
create function pg_temp.duo_state(p_user_1 uuid, p_user_2 uuid) returns text
language sql
as $$
  select status::text || '/' || requester_id::text
    from public.friendships
   where user_low_id = least(p_user_1, p_user_2)
     and user_high_id = greatest(p_user_1, p_user_2);
$$;

-- ----------------------------------------------------------------------------
-- Fixtures. Le trigger handle_new_user_profile crée les profils (visibility
-- 'public' par DÉFAUT — prouvé ci-dessous avant la bascule de U2).
-- ----------------------------------------------------------------------------

insert into auth.users (id, email, aud, role, created_at, updated_at) values
  ('d2000000-0000-4000-8000-000000000001', 'pp-a@petankup.test', 'authenticated', 'authenticated', now(), now()),
  ('d2000000-0000-4000-8000-000000000002', 'pp-b@petankup.test', 'authenticated', 'authenticated', now(), now()),
  ('d2000000-0000-4000-8000-000000000003', 'pp-c@petankup.test', 'authenticated', 'authenticated', now(), now()),
  ('d2000000-0000-4000-8000-000000000004', 'pp-d@petankup.test', 'authenticated', 'authenticated', now(), now()),
  ('d2000000-0000-4000-8000-000000000005', 'pp-e@petankup.test', 'authenticated', 'authenticated', now(), now());

-- Décor clé : le DÉFAUT est 'public' pour les 5 fixtures (C2/P2), scopé par
-- ids — jamais de count global.
select pg_temp.assert_eq_int(
  (select count(*) from public.profiles
    where id in ('d2000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000002',
                 'd2000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-000000000004',
                 'd2000000-0000-4000-8000-000000000005')
      and visibility = 'public'),
  5, 'setup: les 5 profils de fixture sont publics par défaut');

-- Matchs libres via la RPC (le pseudo figé = pseudo courant au moment du
-- match). M1 PUBLIC U2 vs U4 (13-7) ; M3 PRIVÉ U2 + libre (13-5).
select pg_temp.act_as('d2000000-0000-4000-8000-000000000002');
insert into pg_temp.created_matches (label, id)
select 'M1', public.create_free_match(
  '2026-08-20', 'public', 13, 7,
  jsonb_build_array(
    jsonb_build_object('side', 'A', 'user_id', 'd2000000-0000-4000-8000-000000000002'),
    jsonb_build_object('side', 'B', 'user_id', 'd2000000-0000-4000-8000-000000000004')
  ));
insert into pg_temp.created_matches (label, id)
select 'M3', public.create_free_match(
  '2026-08-25', 'private', 13, 5,
  jsonb_build_array(
    jsonb_build_object('side', 'A', 'user_id', 'd2000000-0000-4000-8000-000000000002'),
    jsonb_build_object('side', 'B', 'user_id', null, 'display_name', 'Marcel')
  ));
reset role;

-- M2 PUBLIC U1 + libre (13-9).
select pg_temp.act_as('d2000000-0000-4000-8000-000000000001');
insert into pg_temp.created_matches (label, id)
select 'M2', public.create_free_match(
  '2026-08-22', 'public', 13, 9,
  jsonb_build_array(
    jsonb_build_object('side', 'A', 'user_id', 'd2000000-0000-4000-8000-000000000001'),
    jsonb_build_object('side', 'B', 'user_id', null, 'display_name', 'Odette')
  ));
reset role;

-- T1 : tournoi brouillon de U2, U4 membre — le duo U2-U4 cumule co-tournoi
-- ET co-match (les DEUX branches de l'ancienne règle).
insert into public.tournaments (id, owner_id, name, date, status) values
  ('f7000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000002', 'pp-tournoi', current_date, 'draft');
insert into public.tournament_members (tournament_id, user_id, member_email) values
  ('f7000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000004', 'pp-d@petankup.test');

-- Amitié U2-U3 via les RPC A1.
select pg_temp.act_as('d2000000-0000-4000-8000-000000000002');
select pg_temp.assert_eq_text(
  (select public.request_friendship(
     (select display_name from public.profiles where id = 'd2000000-0000-4000-8000-000000000003'))::text),
  'pending', 'setup: U2 demande U3');
reset role;
select pg_temp.act_as('d2000000-0000-4000-8000-000000000003');
select public.accept_friendship('d2000000-0000-4000-8000-000000000002');
reset role;
select pg_temp.assert_eq_text(
  pg_temp.duo_state('d2000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000003'),
  'accepted/d2000000-0000-4000-8000-000000000002', 'setup: U2 et U3 amis');

-- U2 RENOMMÉ après ses matchs (nom dérivé de l'uuid — pas de collision
-- D.1), puis capture des pseudos et bascule en PRIVÉ.
update public.profiles
   set display_name = 'pp-b-' || substring(id::text, 1, 8)
 where id = 'd2000000-0000-4000-8000-000000000002';

create table pg_temp.fixture_names as
  select id, display_name from public.profiles
   where id in ('d2000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000002',
                'd2000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-000000000004',
                'd2000000-0000-4000-8000-000000000005');
grant select on table pg_temp.fixture_names to authenticated;

create function pg_temp.pseudo(p_user uuid) returns text
language sql
as $$
  select display_name from pg_temp.fixture_names where id = p_user;
$$;

-- Contrôle du décor : le pseudo figé de U2 dans M1 diffère du pseudo à jour.
select pg_temp.assert_eq_int(
  (select count(*) from public.free_match_players
    where match_id = pg_temp.match_id('M1')
      and user_id = 'd2000000-0000-4000-8000-000000000002'
      and display_name is distinct from
          pg_temp.pseudo('d2000000-0000-4000-8000-000000000002')),
  1, 'setup: le pseudo figé de U2 dans M1 diffère du pseudo à jour');

update public.profiles
   set visibility = 'private'
 where id = 'd2000000-0000-4000-8000-000000000002';

-- ----------------------------------------------------------------------------
-- Cas 1 — profil PUBLIC, non-ami : contenu complet.
-- ----------------------------------------------------------------------------

select pg_temp.act_as('d2000000-0000-4000-8000-000000000005');
select pg_temp.assert_keys(
  pg_temp.bundle('d2000000-0000-4000-8000-000000000001'),
  array['profile', 'stats', 'results', 'free_matches', 'free_match_stats'],
  'cas 1a: public/non-ami — les 5 clés du bundle complet');
select pg_temp.assert_eq_int(
  (select json_array_length(pg_temp.bundle('d2000000-0000-4000-8000-000000000001')->'free_matches')),
  1, 'cas 1b: le journal de U1 circule (M2)');
select pg_temp.assert_free_stats_json(
  pg_temp.bundle('d2000000-0000-4000-8000-000000000001')->'free_match_stats',
  1, 1, 0, 13, 9, 'cas 1c: les stats de U1 circulent');

-- ----------------------------------------------------------------------------
-- Cas 2 — profil PRIVÉ, non-ami : { profile, restricted } EXACTEMENT, le
-- pseudo À JOUR (pas le figé).
-- ----------------------------------------------------------------------------

select pg_temp.assert_keys(
  pg_temp.bundle('d2000000-0000-4000-8000-000000000002'),
  array['profile', 'restricted'],
  'cas 2a: privé/non-ami — clés de contenu ABSENTES, pas vides');
select pg_temp.assert_eq_text(
  (pg_temp.bundle('d2000000-0000-4000-8000-000000000002')->>'restricted'),
  'true', 'cas 2b: le marqueur restricted est posé');
select pg_temp.assert_keys(
  pg_temp.bundle('d2000000-0000-4000-8000-000000000002')->'profile',
  array['id', 'display_name', 'created_at', 'updated_at'],
  'cas 2c: le sous-objet profile garde sa forme (sans visibility)');
select pg_temp.assert_eq_text(
  (pg_temp.bundle('d2000000-0000-4000-8000-000000000002')->'profile'->>'display_name'),
  pg_temp.pseudo('d2000000-0000-4000-8000-000000000002'),
  'cas 2d: le pseudo est celui À JOUR (renommé après les matchs), pas le figé');
reset role;

-- ----------------------------------------------------------------------------
-- Cas 3 — privé, AMI : contenu complet.
-- ----------------------------------------------------------------------------

select pg_temp.act_as('d2000000-0000-4000-8000-000000000003');
select pg_temp.assert_keys(
  pg_temp.bundle('d2000000-0000-4000-8000-000000000002'),
  array['profile', 'stats', 'results', 'free_matches', 'free_match_stats'],
  'cas 3a: privé/ami — bundle complet');
select pg_temp.assert_eq_int(
  (select json_array_length(pg_temp.bundle('d2000000-0000-4000-8000-000000000002')->'free_matches')),
  2, 'cas 3b: les 2 matchs de U2 circulent pour un ami');
select pg_temp.assert_free_stats_json(
  pg_temp.bundle('d2000000-0000-4000-8000-000000000002')->'free_match_stats',
  2, 2, 0, 26, 12, 'cas 3c: les stats de U2 circulent pour un ami');
reset role;

-- ----------------------------------------------------------------------------
-- Cas 4 et 5 — soi-même : contenu complet (privé comme public).
-- ----------------------------------------------------------------------------

select pg_temp.act_as('d2000000-0000-4000-8000-000000000002');
select pg_temp.assert_keys(
  pg_temp.bundle('d2000000-0000-4000-8000-000000000002'),
  array['profile', 'stats', 'results', 'free_matches', 'free_match_stats'],
  'cas 4: privé/soi-même — bundle complet');
reset role;
select pg_temp.act_as('d2000000-0000-4000-8000-000000000001');
select pg_temp.assert_keys(
  pg_temp.bundle('d2000000-0000-4000-8000-000000000001'),
  array['profile', 'stats', 'results', 'free_matches', 'free_match_stats'],
  'cas 5: public/soi-même — bundle complet');
reset role;

-- ----------------------------------------------------------------------------
-- Cas 6 — co-tournoi (T1) ET co-match (M1), non amis, profil privé :
-- restreint. Les DEUX branches de l'ancienne règle sont mortes.
-- ----------------------------------------------------------------------------

select pg_temp.act_as('d2000000-0000-4000-8000-000000000004');
select pg_temp.assert_keys(
  pg_temp.bundle('d2000000-0000-4000-8000-000000000002'),
  array['profile', 'restricted'],
  'cas 6: co-joueur non-ami — restreint (l''ancienne règle est supprimée)');
reset role;

-- ----------------------------------------------------------------------------
-- Cas 7 — deux inconnus, public : complet (déjà cas 1) ; preuve TABLE de
-- l'ouverture : U5 lit les 5 lignes de fixtures (l'ancienne policy n'en
-- aurait montré qu'une — la sienne).
-- ----------------------------------------------------------------------------

select pg_temp.act_as('d2000000-0000-4000-8000-000000000005');
select pg_temp.assert_eq_int(
  (select count(*) from public.profiles
    where id in ('d2000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000002',
                 'd2000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-000000000004',
                 'd2000000-0000-4000-8000-000000000005')),
  5, 'cas 7: la page est ouverte — un inconnu lit les 5 lignes de la table');

-- ----------------------------------------------------------------------------
-- Cas 8 — une demande EN ATTENTE n'ouvre pas le contenu.
-- ----------------------------------------------------------------------------

select pg_temp.assert_eq_text(
  (select public.request_friendship(
     (select display_name from public.profiles where id = 'd2000000-0000-4000-8000-000000000002'))::text),
  'pending', 'cas 8a: U5 demande U2 — pending');
select pg_temp.assert_keys(
  pg_temp.bundle('d2000000-0000-4000-8000-000000000002'),
  array['profile', 'restricted'],
  'cas 8b: pending ≠ accès — toujours restreint');
reset role;

-- ----------------------------------------------------------------------------
-- Cas 9 — accepter ouvre ; retirer re-masque.
-- ----------------------------------------------------------------------------

select pg_temp.act_as('d2000000-0000-4000-8000-000000000002');
select public.accept_friendship('d2000000-0000-4000-8000-000000000005');
reset role;
select pg_temp.act_as('d2000000-0000-4000-8000-000000000005');
select pg_temp.assert_keys(
  pg_temp.bundle('d2000000-0000-4000-8000-000000000002'),
  array['profile', 'stats', 'results', 'free_matches', 'free_match_stats'],
  'cas 9a: après acceptation, le contenu devient visible');
reset role;
select pg_temp.act_as('d2000000-0000-4000-8000-000000000002');
select public.remove_friendship('d2000000-0000-4000-8000-000000000005');
reset role;
select pg_temp.act_as('d2000000-0000-4000-8000-000000000005');
select pg_temp.assert_keys(
  pg_temp.bundle('d2000000-0000-4000-8000-000000000002'),
  array['profile', 'restricted'],
  'cas 9b: après retrait, le contenu redevient masqué');

-- ----------------------------------------------------------------------------
-- Cas 10 — id inexistant : forme historique, SANS marqueur — distinguable
-- d'un profil masqué (les trois formes sont deux à deux distinguables).
-- ----------------------------------------------------------------------------

select pg_temp.assert_keys(
  pg_temp.bundle('d2000000-0000-4000-8000-0000000000ff'),
  array['profile', 'stats', 'results', 'free_matches', 'free_match_stats'],
  'cas 10a: inexistant — les 5 clés historiques, pas de marqueur');
select pg_temp.assert_eq_text(
  (select json_typeof(pg_temp.bundle('d2000000-0000-4000-8000-0000000000ff')->'profile')),
  'null', 'cas 10b: inexistant — profile null (masqué a un profile non-null)');
select pg_temp.assert_eq_int(
  (select json_array_length(pg_temp.bundle('d2000000-0000-4000-8000-0000000000ff')->'results')),
  0, 'cas 10c: inexistant — listes vides');
reset role;

-- ----------------------------------------------------------------------------
-- Cas 11 — chacun ne modifie que SON réglage (et son pseudo — couverture
-- héritée de l'ancien harnais) ; anon bloqué. Les relectures de visibility
-- se font en postgres (colonne masquée aux clients).
-- ----------------------------------------------------------------------------

select pg_temp.act_as('d2000000-0000-4000-8000-000000000001');
select pg_temp.assert_row_count(
  $sql$ update public.profiles set visibility = 'private'
         where id = 'd2000000-0000-4000-8000-000000000001' $sql$,
  1, 'cas 11a: U1 bascule SON réglage');
reset role;
select pg_temp.act_as('d2000000-0000-4000-8000-000000000005');
select pg_temp.assert_keys(
  pg_temp.bundle('d2000000-0000-4000-8000-000000000001'),
  array['profile', 'restricted'],
  'cas 11b: la bascule agit — U1 devenu privé est restreint pour U5');
select pg_temp.assert_row_count(
  $sql$ update public.profiles set visibility = 'public'
         where id = 'd2000000-0000-4000-8000-000000000001' $sql$,
  0, 'cas 11c: U5 ne modifie pas le réglage de U1 (0 ligne)');
select pg_temp.assert_row_count(
  $sql$ update public.profiles set visibility = 'public'
         where id = 'd2000000-0000-4000-8000-000000000002' $sql$,
  0, 'cas 11d: ni celui de U2');
select pg_temp.assert_row_count(
  $sql$ update public.profiles set display_name = 'pp-e-' || substring(id::text, 1, 8)
         where id = 'd2000000-0000-4000-8000-000000000005' $sql$,
  1, 'cas 11e: update self de display_name toujours permis (héritage)');
reset role;
select pg_temp.assert_eq_int(
  (select count(*) from public.profiles
    where id = 'd2000000-0000-4000-8000-000000000001' and visibility = 'private'),
  1, 'cas 11f: le réglage de U1 est resté privé (contrôle postgres)');
select pg_temp.act_as('d2000000-0000-4000-8000-000000000001');
select pg_temp.assert_row_count(
  $sql$ update public.profiles set visibility = 'public'
         where id = 'd2000000-0000-4000-8000-000000000001' $sql$,
  1, 'cas 11g: U1 revient en public');
reset role;
set local role anon;
select pg_temp.assert_blocked(
  $sql$ update public.profiles set visibility = 'private' $sql$,
  '42501', null, 'cas 11h: anon ne modifie rien');
reset role;

-- ----------------------------------------------------------------------------
-- Cas 12 — le contenu autorisé est identique à avant : forme du bundle et
-- d'une entrée de journal (patron du cas 9 de free_matches_in_profile) ;
-- la gate A2 s'ajoute à not_authenticated, elle ne le remplace pas.
-- ----------------------------------------------------------------------------

select pg_temp.act_as('d2000000-0000-4000-8000-000000000005');
select pg_temp.assert_keys(
  pg_temp.bundle('d2000000-0000-4000-8000-000000000001')->'profile',
  array['id', 'display_name', 'created_at', 'updated_at'],
  'cas 12a: profile — les 4 clés historiques, jamais visibility');
select pg_temp.assert_keys(
  pg_temp.bundle('d2000000-0000-4000-8000-000000000001')->'free_matches'->0,
  array['match_id', 'played_on', 'created_at', 'score_a', 'score_b', 'side',
        'viewer_can_open', 'teammates', 'opponents'],
  'cas 12b: une entrée de journal garde ses 9 clés historiques');
reset role;
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select pg_temp.assert_blocked(
  $sql$ select public.get_user_profile('d2000000-0000-4000-8000-000000000001') $sql$,
  'P0001', 'not_authenticated', 'cas 12c: sans identité — not_authenticated (la gate est EN PLUS)');
reset role;
set local role anon;
select pg_temp.assert_blocked(
  $sql$ select public.get_user_profile('d2000000-0000-4000-8000-000000000001') $sql$,
  '42501', null, 'cas 12d: anon sans EXECUTE sur la RPC');
reset role;

-- ----------------------------------------------------------------------------
-- Cas F — FRONTIÈRE des objets publics (arbitrage 2026-09-02, R6 spec) et
-- colonne masquée. La confidentialité du profil protège l'AGRÉGAT : un
-- objet PUBLIC reste lisible avec ses participants.
-- ----------------------------------------------------------------------------

select pg_temp.act_as('d2000000-0000-4000-8000-000000000005');
select pg_temp.assert_eq_int(
  (select count(*) from public.free_match_players
    where match_id = pg_temp.match_id('M1')
      and user_id = 'd2000000-0000-4000-8000-000000000002'),
  1, 'cas F1: la participation de U2 (privé) au match PUBLIC M1 reste lisible — frontière assumée');
select pg_temp.assert_eq_int(
  (select count(*) from public.free_match_players
    where match_id = pg_temp.match_id('M3')),
  0, 'cas F2: les participants du match PRIVÉ M3 restent invisibles à un tiers');
select pg_temp.assert_blocked(
  $sql$ select visibility from public.profiles
         where id = 'd2000000-0000-4000-8000-000000000001' $sql$,
  '42501', null, 'cas F3: la colonne visibility n''est pas lisible en direct (grant par colonne)');
reset role;
set local role anon;
select pg_temp.assert_blocked(
  $sql$ select id from public.profiles limit 1 $sql$,
  '42501', null, 'cas F4: anon ne lit pas la table profiles');
reset role;

select 'profile_privacy_check: OK — cas 1-12 + frontière verts (le cas 13 du ticket = les 8 harnais existants rejoués séparément)' as result;

rollback;
