-- ============================================================================
-- friendship_check.sql — vérification manuelle de la relation d'amitié
-- (migration 20260901180000_friendship_schema).
--
-- HORS CI : à exécuter à la main dans le SQL Editor de Supabase Studio (ou
-- psql sur la stack locale). Tout est encadré par begin/rollback : aucune
-- ligne ne reste en base. Si une assertion échoue, un raise exception
-- interrompt le script — la transaction avortée annule tout de toute façon.
--
-- Parité d'environnement : AUCUN grant posé sur les tables du schéma —
-- friendships est deny-total sur TOUS les environnements (aucun privilège
-- authenticated/anon), et le harnais ne touche aux autres tables qu'en
-- postgres (fixtures). Les accès directs doivent échouer en 42501 partout.
-- Ne PAS reproduire le bloc de grants de tournament_freeze_check : il
-- testerait un état qui n'existe pas en production.
--
-- Simulation d'identité : pg_temp.act_as(<user>) pose request.jwt.claims
-- (set_config transaction-local, traverse les DEFINER : auth.uid() = le
-- user simulé) puis set local role authenticated ; reset role rend la main
-- à postgres pour les fixtures et lectures de contrôle (friendships est
-- deny-total : toute lecture d'état passe par postgres).
--
-- Décor (fixtures en postgres, préfixe uuid a1 — libre, vérifié sur les 8
-- harnais existants) : A, B, C (le trio des actions), D (tiers sans
-- relation, puis compte supprimé au cas 14), E (partenaire de D pour la
-- cascade F7). Pseudos capturés dans pg_temp.fixture_names — jamais de
-- constante (D.1 peut suffixer). Les uuids sont croissants (A < B < C <
-- D < E) : l'ordre canonique (low, high) de chaque duo est connu d'avance.
--
-- ⚠️ updated_at ne bouge pas dans une transaction unique (now() est gelé) :
-- aucune assertion de monotonie temporelle.
--
-- Cas (ordre d'exécution = numérotation ; chaque cas s'appuie sur l'état
-- laissé par le précédent). Correspondance avec les cas du ticket A1 entre
-- parenthèses ; le cas 11 est l'ajout validé par Clément (A8/F8) :
--   1  demande nominale A→B : retour 'pending', ligne unique en ordre
--      canonique, requester = A, listes sent/received des deux côtés ;
--      filets structurels en postgres (hors ordre, auto-duo, doublon,
--      requester hors duo → 23514 / 23505) (= ticket 1).
--   2  redemander → already_requested (= ticket 6a).
--   3  l'expéditeur ne peut ni accepter ni refuser → not_addressee
--      (= ticket 3).
--   4  B accepte → amitié, requester conservé ; redemander →
--      already_friends (= ticket 6b) ; re-accepter / refuser une amitié →
--      request_not_found (= ticket 2).
--   5  lecture : trois listes, pseudo de l'autre des deux côtés, une
--      entrée n'expose que user_id + display_name (= ticket 11).
--   6  demandes croisées (F5) : A→C pending puis C→A → 'accepted', UNE
--      ligne, requester d'origine ; amis triés alphabétiquement
--      (= ticket 5).
--   7  auto-demande → self_request, y compris via casse/espaces
--      (= ticket 7).
--   8  pseudo inconnu / vide / NULL → display_name_not_found ; casse et
--      espaces normalisés sur une demande valide B→C (= ticket 8).
--   9  refus par le destinataire : ligne SUPPRIMÉE ; redemander marche
--      (= ticket 4).
--   10 tiers : remove no-op, accept/refuse → request_not_found, lignes des
--      autres intactes ; remove ne touche pas une demande pending
--      (= ticket 10).
--   11 annulation (A8/F8, issues distinguées par 20260902150000) : le
--      destinataire ne peut pas annuler (not_requester) ; une relation
--      devenue AMITIÉ → already_friends (l'utilisateur doit savoir qu'il
--      a un ami à retirer) ; « plus rien » → request_not_found, INDISTINCT
--      par décision — un tiers (11c), une demande REFUSÉE (11h) et une
--      demande jamais envoyée donnent le même code (on ne révèle jamais
--      qui a refusé) ; le demandeur annule (ligne supprimée) et peut
--      redemander.
--   12 retrait par l'un PUIS par l'autre (scénario recréé) : silencieux,
--      supprimé des deux côtés, idempotent ; redemander après retrait
--      (= ticket 9).
--   13 cloisonnement : select/insert/update/delete directs → 42501
--      (authenticated ET anon) ; un compte sans relations voit trois
--      listes vides — jamais les relations des autres (= ticket 12).
--   14 suppression de compte (F7) : D supprimé → la relation D-E disparaît,
--      celles des autres restent ; la liste de E se réduit sans
--      explication. Pas d'artefact FK de transaction unique ici : la
--      cascade friendships est un DELETE pur (l'artefact du cas 13 de
--      free_match_check venait d'un ON DELETE SET NULL, un UPDATE
--      re-vérifié) (= ticket 13).
--   15 sans identité → not_authenticated sur les 6 RPC ; rôle anon → 42501.
--   (La « non-régression » du ticket, cas 14, = les 8 harnais existants
--   rejoués SÉPARÉMENT, fichiers autonomes.)
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- Helpers d'assertion (pg_temp : jetés au rollback / fin de session).
-- assert_eq_int / assert_eq_text / assert_blocked / act_as : verbatim de
-- find_account_check.sql. assert_keys / assert_names : verbatim de
-- free_matches_in_profile_check.sql.
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

-- Séquence des display_name d'un tableau json d'entrées, dans l'ordre du
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

-- ----------------------------------------------------------------------------
-- Fixtures (en postgres). Le trigger handle_new_user_profile crée les
-- profils depuis l'email.
-- ----------------------------------------------------------------------------

insert into auth.users (id, email, aud, role, created_at, updated_at) values
  ('a1000000-0000-4000-8000-000000000001', 'friend-check-a@petankup.test', 'authenticated', 'authenticated', now(), now()),
  ('a1000000-0000-4000-8000-000000000002', 'friend-check-b@petankup.test', 'authenticated', 'authenticated', now(), now()),
  ('a1000000-0000-4000-8000-000000000003', 'friend-check-c@petankup.test', 'authenticated', 'authenticated', now(), now()),
  ('a1000000-0000-4000-8000-000000000004', 'friend-check-d@petankup.test', 'authenticated', 'authenticated', now(), now()),
  ('a1000000-0000-4000-8000-000000000005', 'friend-check-e@petankup.test', 'authenticated', 'authenticated', now(), now());

create table pg_temp.fixture_names as
  select id, display_name from public.profiles
   where id in ('a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002',
                'a1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000004',
                'a1000000-0000-4000-8000-000000000005');
grant select on table pg_temp.fixture_names to authenticated;

create function pg_temp.pseudo(p_user uuid) returns text
language sql
as $$
  select display_name from pg_temp.fixture_names where id = p_user;
$$;

-- État d'un duo, quel que soit le sens donné (lectures de contrôle en
-- postgres uniquement : friendships est deny-total).
create function pg_temp.duo_count(p_user_1 uuid, p_user_2 uuid) returns bigint
language sql
as $$
  select count(*) from public.friendships
   where user_low_id = least(p_user_1, p_user_2)
     and user_high_id = greatest(p_user_1, p_user_2);
$$;

-- « <status>/<requester_id> » — statut et demandeur en une assertion.
create function pg_temp.duo_state(p_user_1 uuid, p_user_2 uuid) returns text
language sql
as $$
  select status::text || '/' || requester_id::text
    from public.friendships
   where user_low_id = least(p_user_1, p_user_2)
     and user_high_id = greatest(p_user_1, p_user_2);
$$;

-- Le bundle des relations, vu par l'identité simulée courante.
create function pg_temp.lists() returns json
language sql
as $$
  select public.get_friendships();
$$;

select pg_temp.assert_eq_int(
  (select count(*) from pg_temp.fixture_names), 5, 'setup: 5 profils créés');

-- ----------------------------------------------------------------------------
-- Cas 1 — demande nominale A→B, et filets structurels de la table.
-- ----------------------------------------------------------------------------

select pg_temp.act_as('a1000000-0000-4000-8000-000000000001');

select pg_temp.assert_eq_text(
  (select public.request_friendship(pg_temp.pseudo('a1000000-0000-4000-8000-000000000002'))::text),
  'pending', 'cas 1a: demande A→B — retour pending');

select pg_temp.assert_names(pg_temp.lists()->'sent',
  array[pg_temp.pseudo('a1000000-0000-4000-8000-000000000002')],
  'cas 1b: A voit sa demande envoyée, avec le pseudo de B');
select pg_temp.assert_names(pg_temp.lists()->'received', '{}'::text[], 'cas 1c: A ne reçoit rien');
select pg_temp.assert_names(pg_temp.lists()->'friends', '{}'::text[], 'cas 1d: A n''a pas encore d''ami');

reset role;
select pg_temp.act_as('a1000000-0000-4000-8000-000000000002');
select pg_temp.assert_names(pg_temp.lists()->'received',
  array[pg_temp.pseudo('a1000000-0000-4000-8000-000000000001')],
  'cas 1e: B voit la demande reçue de A');
select pg_temp.assert_names(pg_temp.lists()->'sent', '{}'::text[], 'cas 1f: B n''a rien envoyé');

reset role;
select pg_temp.assert_eq_int(
  pg_temp.duo_count('a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002'),
  1, 'cas 1g: une seule ligne pour le duo');
select pg_temp.assert_eq_int(
  (select count(*) from public.friendships
    where user_low_id = 'a1000000-0000-4000-8000-000000000001'
      and user_high_id = 'a1000000-0000-4000-8000-000000000002'),
  1, 'cas 1h: rangée en ordre canonique (low = A < high = B)');
select pg_temp.assert_eq_text(
  pg_temp.duo_state('a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002'),
  'pending/a1000000-0000-4000-8000-000000000001', 'cas 1i: en attente, requester = A');

-- Filets structurels (insert direct en postgres — précédent « CHECK en
-- filet » de free_match_check, cas 6) : la structure porte la règle.
select pg_temp.assert_blocked(
  $sql$ insert into public.friendships (user_low_id, user_high_id, requester_id)
        values ('a1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000002',
                'a1000000-0000-4000-8000-000000000002') $sql$,
  '23514', null, 'cas 1j: insertion hors ordre rejetée (friendships_ordered_pair)');
select pg_temp.assert_blocked(
  $sql$ insert into public.friendships (user_low_id, user_high_id, requester_id)
        values ('a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002',
                'a1000000-0000-4000-8000-000000000002') $sql$,
  '23514', null, 'cas 1k: auto-duo rejeté (F6 structurel)');
select pg_temp.assert_blocked(
  $sql$ insert into public.friendships (user_low_id, user_high_id, requester_id)
        values ('a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002',
                'a1000000-0000-4000-8000-000000000001') $sql$,
  '23505', null, 'cas 1l: doublon de duo rejeté (friendships_unique_pair)');
select pg_temp.assert_blocked(
  $sql$ insert into public.friendships (user_low_id, user_high_id, requester_id)
        values ('a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000003',
                'a1000000-0000-4000-8000-000000000001') $sql$,
  '23514', null, 'cas 1m: requester hors duo rejeté (friendships_requester_in_pair)');

-- ----------------------------------------------------------------------------
-- Cas 2 — redemander le même duo.
-- ----------------------------------------------------------------------------

select pg_temp.act_as('a1000000-0000-4000-8000-000000000001');
select pg_temp.assert_blocked(
  $sql$ select public.request_friendship(pg_temp.pseudo('a1000000-0000-4000-8000-000000000002')) $sql$,
  'P0001', 'already_requested', 'cas 2: redemander → already_requested');

-- ----------------------------------------------------------------------------
-- Cas 3 — l'expéditeur ne peut ni accepter ni refuser sa propre demande.
-- ----------------------------------------------------------------------------

select pg_temp.assert_blocked(
  $sql$ select public.accept_friendship('a1000000-0000-4000-8000-000000000002') $sql$,
  'P0001', 'not_addressee', 'cas 3a: l''expéditeur ne peut pas accepter');
select pg_temp.assert_blocked(
  $sql$ select public.refuse_friendship('a1000000-0000-4000-8000-000000000002') $sql$,
  'P0001', 'not_addressee', 'cas 3b: ni refuser');

-- ----------------------------------------------------------------------------
-- Cas 4 — B accepte ; les états consommés ne se rejouent pas.
-- ----------------------------------------------------------------------------

reset role;
select pg_temp.act_as('a1000000-0000-4000-8000-000000000002');
select public.accept_friendship('a1000000-0000-4000-8000-000000000001');
reset role;
select pg_temp.assert_eq_text(
  pg_temp.duo_state('a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002'),
  'accepted/a1000000-0000-4000-8000-000000000001',
  'cas 4a: amitié acceptée, requester d''origine conservé');

select pg_temp.act_as('a1000000-0000-4000-8000-000000000001');
select pg_temp.assert_blocked(
  $sql$ select public.request_friendship(pg_temp.pseudo('a1000000-0000-4000-8000-000000000002')) $sql$,
  'P0001', 'already_friends', 'cas 4b: redemander un ami → already_friends');
reset role;
select pg_temp.act_as('a1000000-0000-4000-8000-000000000002');
select pg_temp.assert_blocked(
  $sql$ select public.accept_friendship('a1000000-0000-4000-8000-000000000001') $sql$,
  'P0001', 'request_not_found', 'cas 4c: re-accepter — plus de demande en attente');
select pg_temp.assert_blocked(
  $sql$ select public.refuse_friendship('a1000000-0000-4000-8000-000000000001') $sql$,
  'P0001', 'request_not_found', 'cas 4d: refuser une amitié — le refus ne vise que les demandes');

-- ----------------------------------------------------------------------------
-- Cas 5 — lecture : les trois listes, sans fuite de structure.
-- ----------------------------------------------------------------------------

select pg_temp.assert_keys(pg_temp.lists(),
  array['friends', 'received', 'sent'], 'cas 5a: les trois listes du bundle');
select pg_temp.assert_names(pg_temp.lists()->'friends',
  array[pg_temp.pseudo('a1000000-0000-4000-8000-000000000001')], 'cas 5b: B voit A dans ses amis');
select pg_temp.assert_names(pg_temp.lists()->'received', '{}'::text[], 'cas 5c: plus de demande reçue');
select pg_temp.assert_keys(pg_temp.lists()->'friends'->0,
  array['user_id', 'display_name'],
  'cas 5d: une entrée n''expose que user_id et display_name — jamais low/high/requester');
select pg_temp.assert_eq_text(
  (pg_temp.lists()->'friends'->0->>'user_id'),
  'a1000000-0000-4000-8000-000000000001', 'cas 5e: l''user_id de l''autre, utilisable par les actions');
reset role;
select pg_temp.act_as('a1000000-0000-4000-8000-000000000001');
select pg_temp.assert_names(pg_temp.lists()->'friends',
  array[pg_temp.pseudo('a1000000-0000-4000-8000-000000000002')], 'cas 5f: symétrique côté A');

-- ----------------------------------------------------------------------------
-- Cas 6 — demandes croisées (F5) : la seconde ACCEPTE, jamais de doublon.
-- ----------------------------------------------------------------------------

select pg_temp.assert_eq_text(
  (select public.request_friendship(pg_temp.pseudo('a1000000-0000-4000-8000-000000000003'))::text),
  'pending', 'cas 6a: A demande C');
reset role;
select pg_temp.act_as('a1000000-0000-4000-8000-000000000003');
select pg_temp.assert_eq_text(
  (select public.request_friendship(pg_temp.pseudo('a1000000-0000-4000-8000-000000000001'))::text),
  'accepted', 'cas 6b: la demande croisée ACCEPTE (F5)');
reset role;
select pg_temp.assert_eq_int(
  pg_temp.duo_count('a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000003'),
  1, 'cas 6c: toujours une seule ligne pour le duo');
select pg_temp.assert_eq_text(
  pg_temp.duo_state('a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000003'),
  'accepted/a1000000-0000-4000-8000-000000000001',
  'cas 6d: la ligne existante a été acceptée (requester d''origine), pas recréée');
select pg_temp.act_as('a1000000-0000-4000-8000-000000000001');
select pg_temp.assert_names(pg_temp.lists()->'friends',
  array[pg_temp.pseudo('a1000000-0000-4000-8000-000000000002'),
        pg_temp.pseudo('a1000000-0000-4000-8000-000000000003')],
  'cas 6e: amis triés alphabétiquement');

-- ----------------------------------------------------------------------------
-- Cas 7 — auto-demande.
-- ----------------------------------------------------------------------------

select pg_temp.assert_blocked(
  $sql$ select public.request_friendship(pg_temp.pseudo('a1000000-0000-4000-8000-000000000001')) $sql$,
  'P0001', 'self_request', 'cas 7a: se demander soi-même');
select pg_temp.assert_blocked(
  $sql$ select public.request_friendship('  ' || upper(pg_temp.pseudo('a1000000-0000-4000-8000-000000000001')) || '  ') $sql$,
  'P0001', 'self_request', 'cas 7b: même via casse et espaces (normalisation partagée)');

-- ----------------------------------------------------------------------------
-- Cas 8 — pseudo inconnu / vide / NULL ; normalisation à la demande.
-- ----------------------------------------------------------------------------

reset role;
select pg_temp.act_as('a1000000-0000-4000-8000-000000000002');
select pg_temp.assert_blocked(
  $sql$ select public.request_friendship('Personne') $sql$,
  'P0001', 'display_name_not_found', 'cas 8a: pseudo inconnu');
select pg_temp.assert_blocked(
  $sql$ select public.request_friendship('') $sql$,
  'P0001', 'display_name_not_found', 'cas 8b: chaîne vide');
select pg_temp.assert_blocked(
  $sql$ select public.request_friendship(null) $sql$,
  'P0001', 'display_name_not_found', 'cas 8c: NULL');
select pg_temp.assert_eq_text(
  (select public.request_friendship('  ' || upper(pg_temp.pseudo('a1000000-0000-4000-8000-000000000003')) || '  ')::text),
  'pending', 'cas 8d: casse et espaces normalisés — B demande C');
reset role;
select pg_temp.assert_eq_text(
  pg_temp.duo_state('a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000003'),
  'pending/a1000000-0000-4000-8000-000000000002', 'cas 8e: demande B→C en place');

-- ----------------------------------------------------------------------------
-- Cas 9 — le refus efface ; redemander marche (A5/F4).
-- ----------------------------------------------------------------------------

select pg_temp.act_as('a1000000-0000-4000-8000-000000000003');
select public.refuse_friendship('a1000000-0000-4000-8000-000000000002');
reset role;
select pg_temp.assert_eq_int(
  pg_temp.duo_count('a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000003'),
  0, 'cas 9a: le refus SUPPRIME la ligne — aucune trace');
select pg_temp.act_as('a1000000-0000-4000-8000-000000000002');
select pg_temp.assert_eq_text(
  (select public.request_friendship(pg_temp.pseudo('a1000000-0000-4000-8000-000000000003'))::text),
  'pending', 'cas 9b: redemander après refus marche');
reset role;
select pg_temp.assert_eq_text(
  pg_temp.duo_state('a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000003'),
  'pending/a1000000-0000-4000-8000-000000000002', 'cas 9c: nouvelle demande en place');

-- ----------------------------------------------------------------------------
-- Cas 10 — un tiers ne peut rien sur le duo des autres ; le retrait ne
-- touche pas une demande en attente.
-- ----------------------------------------------------------------------------

select pg_temp.act_as('a1000000-0000-4000-8000-000000000004');
select public.remove_friendship('a1000000-0000-4000-8000-000000000002');  -- no-op : D-B n'existe pas
select public.remove_friendship('a1000000-0000-4000-8000-000000000003');  -- no-op : D-C n'existe pas
select pg_temp.assert_blocked(
  $sql$ select public.accept_friendship('a1000000-0000-4000-8000-000000000002') $sql$,
  'P0001', 'request_not_found', 'cas 10a: un tiers ne peut pas accepter la demande d''un autre duo');
select pg_temp.assert_blocked(
  $sql$ select public.refuse_friendship('a1000000-0000-4000-8000-000000000002') $sql$,
  'P0001', 'request_not_found', 'cas 10b: ni la refuser');
reset role;
select pg_temp.assert_eq_text(
  pg_temp.duo_state('a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000003'),
  'pending/a1000000-0000-4000-8000-000000000002',
  'cas 10c: la demande B→C est intacte — le retrait d''un tiers est structurellement un no-op');
select pg_temp.assert_eq_text(
  pg_temp.duo_state('a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002'),
  'accepted/a1000000-0000-4000-8000-000000000001', 'cas 10d: l''amitié A-B intacte');

-- Le retrait ne touche que les amitiés acceptées : sur une demande en
-- attente, il est un no-op (l'annulation est l'action dédiée — cas 11).
select pg_temp.act_as('a1000000-0000-4000-8000-000000000002');
select public.remove_friendship('a1000000-0000-4000-8000-000000000003');
reset role;
select pg_temp.assert_eq_text(
  pg_temp.duo_state('a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000003'),
  'pending/a1000000-0000-4000-8000-000000000002',
  'cas 10e: remove ne « retire » pas une demande en attente — no-op');

-- ----------------------------------------------------------------------------
-- Cas 11 — annulation d'une demande envoyée (A8/F8, ajout validé) : action
-- dédiée, réservée au demandeur, uniquement en attente.
-- ----------------------------------------------------------------------------

-- Le destinataire ne peut pas annuler à la place du demandeur.
select pg_temp.act_as('a1000000-0000-4000-8000-000000000003');
select pg_temp.assert_blocked(
  $sql$ select public.cancel_friendship_request('a1000000-0000-4000-8000-000000000002') $sql$,
  'P0001', 'not_requester', 'cas 11a: le destinataire ne peut pas annuler — il refuse');
reset role;

-- Une relation devenue amitié est NOMMÉE (20260902150000) : l'appelant
-- doit savoir qu'il a maintenant un ami à retirer, pas croire qu'il a
-- annulé.
select pg_temp.act_as('a1000000-0000-4000-8000-000000000001');
select pg_temp.assert_blocked(
  $sql$ select public.cancel_friendship_request('a1000000-0000-4000-8000-000000000002') $sql$,
  'P0001', 'already_friends', 'cas 11b: annuler une relation devenue amitié → already_friends');
reset role;

-- Un tiers ne peut structurellement rien annuler (sa paire n'existe pas).
select pg_temp.act_as('a1000000-0000-4000-8000-000000000004');
select pg_temp.assert_blocked(
  $sql$ select public.cancel_friendship_request('a1000000-0000-4000-8000-000000000002') $sql$,
  'P0001', 'request_not_found', 'cas 11c: un tiers n''annule rien');
reset role;

-- Le demandeur annule : la ligne disparaît — aucune trace.
select pg_temp.act_as('a1000000-0000-4000-8000-000000000002');
select public.cancel_friendship_request('a1000000-0000-4000-8000-000000000003');
reset role;
select pg_temp.assert_eq_int(
  pg_temp.duo_count('a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000003'),
  0, 'cas 11d: l''annulation SUPPRIME la ligne');

-- Et il peut redemander aussitôt (même doctrine que le refus, A5/A8).
select pg_temp.act_as('a1000000-0000-4000-8000-000000000002');
select pg_temp.assert_eq_text(
  (select public.request_friendship(pg_temp.pseudo('a1000000-0000-4000-8000-000000000003'))::text),
  'pending', 'cas 11e: redemander après annulation marche');
reset role;
select pg_temp.assert_eq_text(
  pg_temp.duo_state('a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000003'),
  'pending/a1000000-0000-4000-8000-000000000002', 'cas 11f: nouvelle demande B→C en place');

-- Preuve d'INDISTINCTION du refus (20260902150000) : une demande refusée
-- puis annulée donne le même code qu'un tiers (11c) et qu'une demande
-- jamais envoyée — le refus n'est pas révélé au demandeur.
select pg_temp.act_as('a1000000-0000-4000-8000-000000000003');
select public.refuse_friendship('a1000000-0000-4000-8000-000000000002');
reset role;
select pg_temp.assert_eq_int(
  pg_temp.duo_count('a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000003'),
  0, 'cas 11g: décor — C a refusé la demande B→C');
select pg_temp.act_as('a1000000-0000-4000-8000-000000000002');
select pg_temp.assert_blocked(
  $sql$ select public.cancel_friendship_request('a1000000-0000-4000-8000-000000000003') $sql$,
  'P0001', 'request_not_found', 'cas 11h: annuler après un refus → request_not_found, indistinct du « jamais existé »');
select pg_temp.assert_eq_text(
  (select public.request_friendship(pg_temp.pseudo('a1000000-0000-4000-8000-000000000003'))::text),
  'pending', 'cas 11i: B redemande — l''état B→C attendu par la suite est restauré');
reset role;

-- ----------------------------------------------------------------------------
-- Cas 12 — retrait unilatéral, silencieux, idempotent ; redemander marche.
-- ----------------------------------------------------------------------------

select pg_temp.act_as('a1000000-0000-4000-8000-000000000002');
select public.remove_friendship('a1000000-0000-4000-8000-000000000001');  -- retrait par le non-demandeur
reset role;
select pg_temp.assert_eq_int(
  pg_temp.duo_count('a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002'),
  0, 'cas 12a: retrait par l''un — ligne supprimée');
select pg_temp.act_as('a1000000-0000-4000-8000-000000000001');
select pg_temp.assert_names(pg_temp.lists()->'friends',
  array[pg_temp.pseudo('a1000000-0000-4000-8000-000000000003')],
  'cas 12b: la relation a disparu des deux côtés');
select public.remove_friendship('a1000000-0000-4000-8000-000000000003');  -- retrait par le demandeur
select public.remove_friendship('a1000000-0000-4000-8000-000000000003');  -- 2e appel : no-op idempotent
select pg_temp.assert_names(pg_temp.lists()->'friends', '{}'::text[], 'cas 12c: plus d''amis côté A');
reset role;
select pg_temp.assert_eq_int(
  pg_temp.duo_count('a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000003'),
  0, 'cas 12d: ligne A-C supprimée');
select pg_temp.act_as('a1000000-0000-4000-8000-000000000003');
select pg_temp.assert_eq_text(
  (select public.request_friendship(pg_temp.pseudo('a1000000-0000-4000-8000-000000000001'))::text),
  'pending', 'cas 12e: redemander après retrait marche');
reset role;
select pg_temp.assert_eq_text(
  pg_temp.duo_state('a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000003'),
  'pending/a1000000-0000-4000-8000-000000000003', 'cas 12f: le nouveau demandeur est enregistré');

-- ----------------------------------------------------------------------------
-- Cas 13 — cloisonnement : deny-total en direct, et une personne ne voit
-- que SES relations.
-- ----------------------------------------------------------------------------

select pg_temp.act_as('a1000000-0000-4000-8000-000000000003');
select pg_temp.assert_blocked(
  $sql$ select count(*) from public.friendships $sql$,
  '42501', null, 'cas 13a: SELECT direct interdit (deny-total)');
select pg_temp.assert_blocked(
  $sql$ insert into public.friendships (user_low_id, user_high_id, requester_id)
        values ('a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000003',
                'a1000000-0000-4000-8000-000000000003') $sql$,
  '42501', null, 'cas 13b: INSERT direct interdit');
select pg_temp.assert_blocked(
  $sql$ update public.friendships set status = 'accepted' $sql$,
  '42501', null, 'cas 13c: UPDATE direct interdit');
select pg_temp.assert_blocked(
  $sql$ delete from public.friendships $sql$,
  '42501', null, 'cas 13d: DELETE direct interdit');
reset role;
set local role anon;
select pg_temp.assert_blocked(
  $sql$ select count(*) from public.friendships $sql$,
  '42501', null, 'cas 13e: SELECT direct interdit à anon');
reset role;
-- D n'a aucune relation : trois listes vides, alors que des relations
-- existent en base (A-C et B-C en attente) — il ne voit RIEN des autres.
select pg_temp.act_as('a1000000-0000-4000-8000-000000000004');
select pg_temp.assert_names(pg_temp.lists()->'friends', '{}'::text[], 'cas 13f: D — amis vides');
select pg_temp.assert_names(pg_temp.lists()->'received', '{}'::text[], 'cas 13g: D — reçues vides');
select pg_temp.assert_names(pg_temp.lists()->'sent', '{}'::text[], 'cas 13h: D — envoyées vides');
reset role;

-- ----------------------------------------------------------------------------
-- Cas 14 — suppression de compte (F7). Décor : D-E amis (via les RPC),
-- B→E en attente (doit survivre).
-- ----------------------------------------------------------------------------

select pg_temp.act_as('a1000000-0000-4000-8000-000000000004');
select pg_temp.assert_eq_text(
  (select public.request_friendship(pg_temp.pseudo('a1000000-0000-4000-8000-000000000005'))::text),
  'pending', 'cas 14a: décor — D demande E');
reset role;
select pg_temp.act_as('a1000000-0000-4000-8000-000000000005');
select public.accept_friendship('a1000000-0000-4000-8000-000000000004');
reset role;
select pg_temp.act_as('a1000000-0000-4000-8000-000000000002');
select pg_temp.assert_eq_text(
  (select public.request_friendship(pg_temp.pseudo('a1000000-0000-4000-8000-000000000005'))::text),
  'pending', 'cas 14b: décor — B demande E');
reset role;
select pg_temp.assert_eq_text(
  pg_temp.duo_state('a1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000005'),
  'accepted/a1000000-0000-4000-8000-000000000004', 'cas 14c: décor — D et E amis');

do $$
declare
  v_state text;
  v_msg text;
begin
  delete from auth.users where id = 'a1000000-0000-4000-8000-000000000004';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  raise exception '[cas 14d: suppression du compte D] ANNULÉE — sqlstate % : %', v_state, v_msg;
end;
$$;

select pg_temp.assert_eq_int(
  (select count(*) from auth.users where id = 'a1000000-0000-4000-8000-000000000004'),
  0, 'cas 14e: compte D supprimé');
select pg_temp.assert_eq_int(
  (select count(*) from public.friendships
    where 'a1000000-0000-4000-8000-000000000004'::uuid in (user_low_id, user_high_id)),
  0, 'cas 14f: plus aucune relation pour D (F7, cascade)');
select pg_temp.assert_eq_text(
  pg_temp.duo_state('a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000005'),
  'pending/a1000000-0000-4000-8000-000000000002', 'cas 14g: la demande B→E des autres est intacte');
select pg_temp.act_as('a1000000-0000-4000-8000-000000000005');
select pg_temp.assert_names(pg_temp.lists()->'friends', '{}'::text[],
  'cas 14h: la liste d''amis de E se réduit sans explication (F7)');
select pg_temp.assert_names(pg_temp.lists()->'received',
  array[pg_temp.pseudo('a1000000-0000-4000-8000-000000000002')],
  'cas 14i: la demande de B reste visible pour E');
reset role;

-- ----------------------------------------------------------------------------
-- Cas 15 — non authentifié → not_authenticated sur les 6 RPC ; anon → 42501.
-- ----------------------------------------------------------------------------

select set_config('request.jwt.claims', '', true);
set local role authenticated;
select pg_temp.assert_blocked(
  $sql$ select public.request_friendship('Peu importe') $sql$,
  'P0001', 'not_authenticated', 'cas 15a: request sans identité');
select pg_temp.assert_blocked(
  $sql$ select public.accept_friendship('a1000000-0000-4000-8000-000000000001') $sql$,
  'P0001', 'not_authenticated', 'cas 15b: accept sans identité');
select pg_temp.assert_blocked(
  $sql$ select public.refuse_friendship('a1000000-0000-4000-8000-000000000001') $sql$,
  'P0001', 'not_authenticated', 'cas 15c: refuse sans identité');
select pg_temp.assert_blocked(
  $sql$ select public.cancel_friendship_request('a1000000-0000-4000-8000-000000000001') $sql$,
  'P0001', 'not_authenticated', 'cas 15d: cancel sans identité');
select pg_temp.assert_blocked(
  $sql$ select public.remove_friendship('a1000000-0000-4000-8000-000000000001') $sql$,
  'P0001', 'not_authenticated', 'cas 15e: remove sans identité');
select pg_temp.assert_blocked(
  $sql$ select public.get_friendships() $sql$,
  'P0001', 'not_authenticated', 'cas 15f: lecture sans identité');
reset role;
set local role anon;
select pg_temp.assert_blocked(
  $sql$ select public.request_friendship('Peu importe') $sql$,
  '42501', null, 'cas 15g: rôle anon sans EXECUTE (request)');
select pg_temp.assert_blocked(
  $sql$ select public.get_friendships() $sql$,
  '42501', null, 'cas 15h: rôle anon sans EXECUTE (lecture)');
reset role;

select 'friendship_check: OK — 15 cas verts (la « non-régression » du ticket = les 8 harnais existants rejoués séparément)' as result;

rollback;
