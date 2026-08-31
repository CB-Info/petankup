-- ============================================================================
-- find_account_check.sql — vérification manuelle de la recherche d'un compte
-- par pseudo (migration 20260828180000) et non-régression de l'invitation.
--
-- HORS CI : à exécuter à la main dans le SQL Editor de Supabase Studio (ou
-- psql sur la stack locale). Tout est encadré par begin/rollback : aucune
-- ligne ne reste en base. Si une assertion échoue, un raise exception
-- interrompt le script — la transaction avortée annule tout de toute façon.
--
-- Simulation d'identité : pg_temp.act_as(<user>) pose request.jwt.claims
-- (set_config transaction-local, traverse les DEFINER : auth.uid() = le user
-- simulé) puis set local role authenticated ; reset role rend la main à
-- postgres pour les fixtures et lectures de contrôle.
--
-- Décor (fixtures en postgres) : A (pseudo forcé « Alice Dupont », casse
-- contrôlée), B, C ; T1 tournoi brouillon de A, T2 tournoi terminé de A.
--
-- Cas :
--   8  NON-RÉGRESSION DE L'INVITATION — bloc délimité par des marqueurs,
--      placé EN PREMIER pour pouvoir être rejoué tel quel sur le schéma
--      d'avant migration (aucun harnais ne couvrait l'invitation jusqu'ici) :
--      succès (member_email = email de l'invité), already_member, self_invite,
--      display_name_not_found, not_owner, tournament_completed,
--      not_authenticated, casse/espaces sur le pseudo invité.
--   1  pseudo existant, casse identique → trouvé (id + pseudo canonique).
--   2  casse différente → trouvé, pseudo canonique renvoyé.
--   3  espaces de bord → trouvé.
--   4  pseudo inexistant → 0 ligne, pas d'erreur ; fragments → 0 ligne.
--   5  chaîne vide, NULL → 0 ligne, pas d'erreur.
--   6  son propre pseudo → se trouve.
--   7  non authentifié → not_authenticated ; rôle anon → 42501.
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

-- ----------------------------------------------------------------------------
-- Fixtures (en postgres). Le trigger handle_new_user_profile crée les
-- profils depuis l'email ; le pseudo de A est ensuite forcé pour contrôler
-- la casse (« Alice Dupont »).
-- ----------------------------------------------------------------------------

insert into auth.users (id, email, aud, role, created_at, updated_at) values
  ('e1000000-0000-4000-8000-000000000001', 'find-check-a@petankup.test', 'authenticated', 'authenticated', now(), now()),
  ('e1000000-0000-4000-8000-000000000002', 'find-check-b@petankup.test', 'authenticated', 'authenticated', now(), now()),
  ('e1000000-0000-4000-8000-000000000003', 'find-check-c@petankup.test', 'authenticated', 'authenticated', now(), now());

update public.profiles set display_name = 'Alice Dupont'
 where id = 'e1000000-0000-4000-8000-000000000001';

insert into public.tournaments (id, owner_id, name, date, status) values
  ('f6000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'find-check-brouillon', current_date, 'draft'),
  ('f6000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000001', 'find-check-termine', current_date, 'draft');
update public.tournaments set status = 'in_progress' where id = 'f6000000-0000-4000-8000-000000000002';
update public.tournaments set status = 'completed'   where id = 'f6000000-0000-4000-8000-000000000002';

select pg_temp.assert_eq_int(
  (select count(*) from public.profiles where id in (
    'e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000003')),
  3, 'setup: 3 profils créés');

-- [invitation-check — début]
-- ----------------------------------------------------------------------------
-- Cas 8 — non-régression de l'invitation. Le pseudo de B est celui dérivé de
-- son email (« find-check-b »), lu depuis profiles pour ne dépendre d'aucune
-- constante (D.1 peut suffixer en cas de collision).
-- ----------------------------------------------------------------------------

create table pg_temp.fixture_names as
  select id, display_name from public.profiles
   where id in ('e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002',
                'e1000000-0000-4000-8000-000000000003');
grant select on table pg_temp.fixture_names to authenticated;

select pg_temp.act_as('e1000000-0000-4000-8000-000000000001');

-- 8a. Succès : A invite B sur T1 ; la ligne porte l'email de B.
select pg_temp.assert_eq_text(
  (select member_email from public.invite_tournament_member_by_display_name(
     'f6000000-0000-4000-8000-000000000001',
     (select display_name from pg_temp.fixture_names where id = 'e1000000-0000-4000-8000-000000000002'))),
  'find-check-b@petankup.test', 'cas 8a: invitation réussie, member_email = email de l''invité');

reset role;
select pg_temp.assert_eq_int(
  (select count(*) from public.tournament_members
    where tournament_id = 'f6000000-0000-4000-8000-000000000001'
      and user_id = 'e1000000-0000-4000-8000-000000000002'),
  1, 'cas 8a: membre inséré');
select pg_temp.act_as('e1000000-0000-4000-8000-000000000001');

-- 8b. Doublon.
select pg_temp.assert_blocked(
  $sql$ select public.invite_tournament_member_by_display_name(
          'f6000000-0000-4000-8000-000000000001',
          (select display_name from pg_temp.fixture_names where id = 'e1000000-0000-4000-8000-000000000002')) $sql$,
  'P0001', 'already_member', 'cas 8b: invitation en double');

-- 8c. Auto-invitation.
select pg_temp.assert_blocked(
  $sql$ select public.invite_tournament_member_by_display_name(
          'f6000000-0000-4000-8000-000000000001', 'Alice Dupont') $sql$,
  'P0001', 'self_invite', 'cas 8c: s''inviter soi-même');

-- 8d. Pseudo inconnu.
select pg_temp.assert_blocked(
  $sql$ select public.invite_tournament_member_by_display_name(
          'f6000000-0000-4000-8000-000000000001', 'Personne') $sql$,
  'P0001', 'display_name_not_found', 'cas 8d: pseudo inconnu');

-- 8e. Tournoi terminé (owner, donc le gate completed s'applique).
select pg_temp.assert_blocked(
  $sql$ select public.invite_tournament_member_by_display_name(
          'f6000000-0000-4000-8000-000000000002',
          (select display_name from pg_temp.fixture_names where id = 'e1000000-0000-4000-8000-000000000002')) $sql$,
  'P0001', 'tournament_completed', 'cas 8e: tournoi terminé');

-- 8f. Casse et espaces sur le pseudo invité : C invité via son pseudo en
-- MAJUSCULES entouré d'espaces (lu dans la fixture postgres : la RLS des
-- profils ne montre pas C à A, ils n'ont aucun tournoi commun).
select pg_temp.assert_eq_text(
  (select member_email from public.invite_tournament_member_by_display_name(
     'f6000000-0000-4000-8000-000000000001',
     '  ' || upper((select display_name from pg_temp.fixture_names where id = 'e1000000-0000-4000-8000-000000000003')) || '  ')),
  'find-check-c@petankup.test', 'cas 8f: casse et espaces normalisés à l''invitation');

-- 8g. Non-owner.
reset role;
select pg_temp.act_as('e1000000-0000-4000-8000-000000000002');
select pg_temp.assert_blocked(
  $sql$ select public.invite_tournament_member_by_display_name(
          'f6000000-0000-4000-8000-000000000001', 'Alice Dupont') $sql$,
  'P0001', 'not_owner', 'cas 8g: non-owner');

-- 8h. Non authentifié (rôle authenticated sans claims).
reset role;
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select pg_temp.assert_blocked(
  $sql$ select public.invite_tournament_member_by_display_name(
          'f6000000-0000-4000-8000-000000000001', 'Alice Dupont') $sql$,
  'P0001', 'not_authenticated', 'cas 8h: non authentifié');
reset role;
-- [invitation-check — fin]

-- Helpers de la recherche (créés APRÈS le bloc invitation : fonctions SQL
-- validées à la création, elles supposent la migration appliquée — le bloc
-- invitation, lui, doit rester rejouable sur le schéma d'avant migration).
-- Nombre de comptes trouvés pour un pseudo, et pseudo canonique renvoyé.
create function pg_temp.found_count(p_display_name text) returns bigint
language sql
as $$
  select count(*) from public.find_account_by_display_name(p_display_name);
$$;

create function pg_temp.found_display_name(p_display_name text) returns text
language sql
as $$
  select account.display_name
    from public.find_account_by_display_name(p_display_name) as account
   limit 1;
$$;


-- ----------------------------------------------------------------------------
-- Cas 1 à 3 — B cherche « Alice Dupont » : casse identique, différente,
-- espaces de bord. Une ligne, l'id de A, le pseudo canonique.
-- ----------------------------------------------------------------------------

select pg_temp.act_as('e1000000-0000-4000-8000-000000000002');

select pg_temp.assert_eq_int(pg_temp.found_count('Alice Dupont'), 1, 'cas 1: casse identique → trouvé');
select pg_temp.assert_eq_text(
  (select account.user_id::text from public.find_account_by_display_name('Alice Dupont') as account),
  'e1000000-0000-4000-8000-000000000001', 'cas 1: id du compte');
select pg_temp.assert_eq_text(pg_temp.found_display_name('Alice Dupont'), 'Alice Dupont', 'cas 1: pseudo canonique');

select pg_temp.assert_eq_int(pg_temp.found_count('alice dupont'), 1, 'cas 2: casse différente → trouvé');
select pg_temp.assert_eq_text(pg_temp.found_display_name('ALICE DUPONT'), 'Alice Dupont', 'cas 2: pseudo canonique, pas la saisie');

select pg_temp.assert_eq_int(pg_temp.found_count('   Alice Dupont   '), 1, 'cas 3: espaces de bord → trouvé');

-- ----------------------------------------------------------------------------
-- Cas 4 — inexistant et fragments : 0 ligne, jamais d'erreur.
-- ----------------------------------------------------------------------------

select pg_temp.assert_eq_int(pg_temp.found_count('Personne'), 0, 'cas 4a: pseudo inexistant → 0 ligne');
select pg_temp.assert_eq_int(pg_temp.found_count('Alice'), 0, 'cas 4b: préfixe → 0 ligne');
select pg_temp.assert_eq_int(pg_temp.found_count('Dupont'), 0, 'cas 4c: suffixe → 0 ligne');
select pg_temp.assert_eq_int(pg_temp.found_count('lice Dup'), 0, 'cas 4d: fragment → 0 ligne');
select pg_temp.assert_eq_int(pg_temp.found_count('Alice%'), 0, 'cas 4e: joker → 0 ligne');

-- ----------------------------------------------------------------------------
-- Cas 5 — chaîne vide et NULL : 0 ligne, jamais d'erreur.
-- ----------------------------------------------------------------------------

select pg_temp.assert_eq_int(pg_temp.found_count(''), 0, 'cas 5a: chaîne vide → 0 ligne');
select pg_temp.assert_eq_int(pg_temp.found_count('   '), 0, 'cas 5b: blanc → 0 ligne');
select pg_temp.assert_eq_int(pg_temp.found_count(null), 0, 'cas 5c: NULL → 0 ligne');

-- ----------------------------------------------------------------------------
-- Cas 6 — B cherche son propre pseudo et se trouve.
-- ----------------------------------------------------------------------------

select pg_temp.assert_eq_text(
  (select account.user_id::text from public.find_account_by_display_name(
     (select display_name from pg_temp.fixture_names where id = 'e1000000-0000-4000-8000-000000000002')) as account),
  'e1000000-0000-4000-8000-000000000002', 'cas 6: se trouve soi-même');

-- ----------------------------------------------------------------------------
-- Cas 7 — non authentifié → not_authenticated ; rôle anon → 42501.
-- ----------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select pg_temp.assert_blocked(
  $sql$ select * from public.find_account_by_display_name('Alice Dupont') $sql$,
  'P0001', 'not_authenticated', 'cas 7a: sans identité');

reset role;
set local role anon;
select pg_temp.assert_blocked(
  $sql$ select * from public.find_account_by_display_name('Alice Dupont') $sql$,
  '42501', null, 'cas 7b: rôle anon sans EXECUTE');
reset role;

select 'find_account_check: OK — 8 cas verts' as result;

rollback;
