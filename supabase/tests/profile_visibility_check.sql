-- ============================================================================
-- profile_visibility_check.sql — vérification manuelle de la règle d'accès
-- aux profils étendue aux matchs communs (migration 20260901120000).
--
-- HORS CI : à exécuter à la main dans le SQL Editor de Supabase Studio (ou
-- psql sur la stack locale). Tout est encadré par begin/rollback : aucune
-- ligne ne reste en base. Si une assertion échoue, un raise exception
-- interrompt le script — la transaction avortée annule tout de toute façon.
--
-- Règle éprouvée : un joueur peut lire le profil d'un autre s'il a joué
-- avec lui — tournoi (sémantique phase_c_1 inchangée) OU match libre,
-- public OU privé, camps confondus. Seuls les participants liés à un
-- compte créent le lien. Helper : private.profile_is_visible_to_current_
-- user (renommé depuis users_share_visible_tournament), consommé par la
-- policy profiles_select_visible — testé ICI sous `set local role
-- authenticated`, donc RLS réelle (modèle find_account_check).
--
-- Parité d'environnement : AUCUN grant sur les tables du schéma dans ce
-- harnais (seules les tables pg_temp en reçoivent) — sinon on testerait un
-- état qui n'existe pas en production.
--
-- Assertions CIBLÉES par id de fixture, jamais de count global : la base
-- hébergée contient des profils réels qui fausseraient tout comptage.
--
-- Décor (« un lien par duo » — chaque duo ne partage qu'UN type de lien,
-- sinon un cas ne prouverait plus rien) :
--   A owner / B membre du tournoi T1 (privé, brouillon — le lien tournoi
--     ne dépend ni du statut ni de la visibilité) ;
--   C et D : match libre PRIVÉ MP1, camps OPPOSÉS (C camp A, D camp B),
--     avec deux joueurs libres (sans compte) ;
--   C et E : match libre PUBLIC MPub, MÊME camp, camp B tout en joueurs
--     libres ;
--   F : aucun lien avec personne.
--   C est RENOMMÉ après l'enregistrement des matchs : son pseudo figé dans
--   free_match_players diffère de son pseudo à jour — le symptôme du
--   ticket, que le cas 4 prouve résolu.
--
-- Cas :
--   1  tournoi commun : A↔B mutuel (inchangé) ; le duo tournoi n'ouvre
--      rien d'autre (A ne voit ni C, D, E, F).
--   2  match libre PUBLIC partagé, même camp : C↔E mutuel.
--   3  match libre PRIVÉ partagé : C↔D mutuel.
--   4  camps OPPOSÉS du même match + symptôme : D lit le pseudo À JOUR
--      de C (renommé après le match), pas le pseudo figé.
--   5  jamais rien partagé : F ne voit personne (0 ligne, pas d'erreur).
--   6  les joueurs sans compte ne créent aucun lien : D↮E (tous deux
--      co-participants de C, jamais du même match — pas de transitivité).
--   7  son propre profil : toujours accessible (F, sans aucun lien) ;
--      update self toujours permis (policies d'écriture non touchées).
--   8  non-régression : les 7 harnais existants rejoués SÉPARÉMENT
--      (fichiers autonomes).
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

-- Lectures sous RLS (INVOKER : sous act_as, la policy de profiles joue).
create function pg_temp.sees(p_target uuid) returns bigint
language sql
as $$ select count(*) from public.profiles where id = p_target; $$;

create function pg_temp.seen_name(p_target uuid) returns text
language sql
as $$ select display_name from public.profiles where id = p_target; $$;

-- ----------------------------------------------------------------------------
-- Fixtures (en postgres, bypass RLS). Le trigger handle_new_user_profile
-- crée les profils. Matchs libres en INSERT direct : le harnais éprouve la
-- RLS de profiles, pas la RPC create_free_match (précédent : les fixtures
-- de tournoi des autres harnais) ; les triggers de stats tirent, sans
-- incidence — tout est rollbacké.
-- ----------------------------------------------------------------------------

insert into auth.users (id, email, aud, role, created_at, updated_at) values
  ('d5000000-0000-4000-8000-000000000001', 'pvc-a@petankup.test', 'authenticated', 'authenticated', now(), now()),
  ('d5000000-0000-4000-8000-000000000002', 'pvc-b@petankup.test', 'authenticated', 'authenticated', now(), now()),
  ('d5000000-0000-4000-8000-000000000003', 'pvc-c@petankup.test', 'authenticated', 'authenticated', now(), now()),
  ('d5000000-0000-4000-8000-000000000004', 'pvc-d@petankup.test', 'authenticated', 'authenticated', now(), now()),
  ('d5000000-0000-4000-8000-000000000005', 'pvc-e@petankup.test', 'authenticated', 'authenticated', now(), now()),
  ('d5000000-0000-4000-8000-000000000006', 'pvc-f@petankup.test', 'authenticated', 'authenticated', now(), now());

-- T1 : privé, brouillon — le lien tournoi (branches 1-2 du helper) ne
-- dépend ni du statut ni de la visibilité.
insert into public.tournaments (id, owner_id, name, date, status) values
  ('f5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000001', 'pvc-tournoi', current_date, 'draft');

insert into public.tournament_members (tournament_id, user_id, member_email) values
  ('f5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000002', 'pvc-b@petankup.test');

-- MP1 privé (C camp A, D camp B) et MPub public (C et E camp A). Pseudo
-- figé = pseudo courant au moment du match, comme le ferait la RPC.
insert into public.free_matches (id, created_by, played_on, score_a, score_b, visibility) values
  ('e5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000003', '2026-08-15', 13, 7, 'private'),
  ('e5000000-0000-4000-8000-000000000002', 'd5000000-0000-4000-8000-000000000003', '2026-08-20', 13, 9, 'public');

insert into public.free_match_players (match_id, side, user_id, display_name) values
  ('e5000000-0000-4000-8000-000000000001', 'A', 'd5000000-0000-4000-8000-000000000003',
     (select display_name from public.profiles where id = 'd5000000-0000-4000-8000-000000000003')),
  ('e5000000-0000-4000-8000-000000000001', 'A', null, 'marcel'),
  ('e5000000-0000-4000-8000-000000000001', 'B', 'd5000000-0000-4000-8000-000000000004',
     (select display_name from public.profiles where id = 'd5000000-0000-4000-8000-000000000004')),
  ('e5000000-0000-4000-8000-000000000001', 'B', null, 'odette'),
  ('e5000000-0000-4000-8000-000000000002', 'A', 'd5000000-0000-4000-8000-000000000003',
     (select display_name from public.profiles where id = 'd5000000-0000-4000-8000-000000000003')),
  ('e5000000-0000-4000-8000-000000000002', 'A', 'd5000000-0000-4000-8000-000000000005',
     (select display_name from public.profiles where id = 'd5000000-0000-4000-8000-000000000005')),
  ('e5000000-0000-4000-8000-000000000002', 'B', null, 'paulette'),
  ('e5000000-0000-4000-8000-000000000002', 'B', null, 'gaston');

-- Le SYMPTÔME du ticket : C change de pseudo APRÈS l'enregistrement des
-- matchs — le pseudo figé de free_match_players ne bouge pas, profiles si.
-- Nom dérivé de l'uuid de fixture : aucune collision D.1 possible (l'index
-- unique lower(trim(display_name)) refuserait en 23505 ; le suffixage D.1
-- ne joue qu'au signup).
update public.profiles
   set display_name = 'pvc-c-' || substring(id::text, 1, 8)
 where id = 'd5000000-0000-4000-8000-000000000003';

-- Capture des pseudos APRÈS le rename de C — D.1 peut avoir suffixé un
-- pseudo de signup en collision : ne jamais comparer à une constante.
create table pg_temp.fixture_names as
  select id, display_name
    from public.profiles
   where id in ('d5000000-0000-4000-8000-000000000001',
                'd5000000-0000-4000-8000-000000000002',
                'd5000000-0000-4000-8000-000000000003',
                'd5000000-0000-4000-8000-000000000004',
                'd5000000-0000-4000-8000-000000000005',
                'd5000000-0000-4000-8000-000000000006');
grant select on table pg_temp.fixture_names to authenticated;

select pg_temp.assert_eq_int(
  (select count(*) from pg_temp.fixture_names), 6, 'setup: 6 profils créés');

-- Contrôle du décor : le pseudo figé de C dans MP1 diffère bien de son
-- pseudo à jour (sinon le cas 4 ne prouverait rien).
select pg_temp.assert_eq_int(
  (select count(*) from public.free_match_players
    where match_id = 'e5000000-0000-4000-8000-000000000001'
      and user_id = 'd5000000-0000-4000-8000-000000000003'
      and display_name is distinct from
          (select display_name from pg_temp.fixture_names
            where id = 'd5000000-0000-4000-8000-000000000003')),
  1, 'setup: le pseudo figé de C dans MP1 diffère du pseudo à jour');

-- ----------------------------------------------------------------------------
-- Cas 1 — tournoi commun : A↔B mutuel, et le duo tournoi n'ouvre rien
-- d'autre.
-- ----------------------------------------------------------------------------

select pg_temp.act_as('d5000000-0000-4000-8000-000000000001');
select pg_temp.assert_eq_int(pg_temp.sees('d5000000-0000-4000-8000-000000000002'), 1, 'cas 1a: A voit B (tournoi commun)');
select pg_temp.assert_eq_int(pg_temp.sees('d5000000-0000-4000-8000-000000000003'), 0, 'cas 1b: A ne voit pas C');
select pg_temp.assert_eq_int(pg_temp.sees('d5000000-0000-4000-8000-000000000004'), 0, 'cas 1c: A ne voit pas D');
select pg_temp.assert_eq_int(pg_temp.sees('d5000000-0000-4000-8000-000000000005'), 0, 'cas 1d: A ne voit pas E');
select pg_temp.assert_eq_int(pg_temp.sees('d5000000-0000-4000-8000-000000000006'), 0, 'cas 1e: A ne voit pas F');
reset role;

select pg_temp.act_as('d5000000-0000-4000-8000-000000000002');
select pg_temp.assert_eq_int(pg_temp.sees('d5000000-0000-4000-8000-000000000001'), 1, 'cas 1f: B voit A (réciproque)');
select pg_temp.assert_eq_int(pg_temp.sees('d5000000-0000-4000-8000-000000000003'), 0, 'cas 1g: B ne voit pas C');
reset role;

-- ----------------------------------------------------------------------------
-- Cas 2 — match libre PUBLIC partagé (même camp) : C↔E mutuel.
-- ----------------------------------------------------------------------------

select pg_temp.act_as('d5000000-0000-4000-8000-000000000005');
select pg_temp.assert_eq_int(pg_temp.sees('d5000000-0000-4000-8000-000000000003'), 1, 'cas 2a: E voit C (match public partagé, même camp)');
reset role;

select pg_temp.act_as('d5000000-0000-4000-8000-000000000003');
select pg_temp.assert_eq_int(pg_temp.sees('d5000000-0000-4000-8000-000000000005'), 1, 'cas 2b: C voit E (réciproque)');
reset role;

-- ----------------------------------------------------------------------------
-- Cas 3 — match libre PRIVÉ partagé : C↔D mutuel.
-- Cas 4 — camps opposés du même match + le symptôme du ticket : D lit le
-- pseudo À JOUR de C, pas le pseudo figé.
-- ----------------------------------------------------------------------------

select pg_temp.act_as('d5000000-0000-4000-8000-000000000003');
select pg_temp.assert_eq_int(pg_temp.sees('d5000000-0000-4000-8000-000000000004'), 1, 'cas 3a: C voit D (match privé partagé)');
reset role;

select pg_temp.act_as('d5000000-0000-4000-8000-000000000004');
select pg_temp.assert_eq_int(pg_temp.sees('d5000000-0000-4000-8000-000000000003'), 1, 'cas 3b: D voit C (réciproque)');
select pg_temp.assert_eq_text(
  pg_temp.seen_name('d5000000-0000-4000-8000-000000000003'),
  (select display_name from pg_temp.fixture_names
    where id = 'd5000000-0000-4000-8000-000000000003'),
  'cas 4: camps opposés — D lit le pseudo à jour de C (renommé après le match)');
reset role;

-- ----------------------------------------------------------------------------
-- Cas 5 — jamais rien partagé : F ne voit personne (0 ligne, pas d'erreur).
-- ----------------------------------------------------------------------------

select pg_temp.act_as('d5000000-0000-4000-8000-000000000006');
select pg_temp.assert_eq_int(pg_temp.sees('d5000000-0000-4000-8000-000000000001'), 0, 'cas 5a: F ne voit pas A');
select pg_temp.assert_eq_int(pg_temp.sees('d5000000-0000-4000-8000-000000000002'), 0, 'cas 5b: F ne voit pas B');
select pg_temp.assert_eq_int(pg_temp.sees('d5000000-0000-4000-8000-000000000003'), 0, 'cas 5c: F ne voit pas C');
select pg_temp.assert_eq_int(pg_temp.sees('d5000000-0000-4000-8000-000000000004'), 0, 'cas 5d: F ne voit pas D');
select pg_temp.assert_eq_int(pg_temp.sees('d5000000-0000-4000-8000-000000000005'), 0, 'cas 5e: F ne voit pas E');
reset role;

-- ----------------------------------------------------------------------------
-- Cas 6 — les joueurs SANS COMPTE (marcel, odette, paulette, gaston) ne
-- créent aucun lien : malgré 4 lignes user_id NULL réparties sur les deux
-- matchs, seuls les duos C-D et C-E se sont ouverts. Pas de transitivité
-- via C non plus.
-- ----------------------------------------------------------------------------

select pg_temp.act_as('d5000000-0000-4000-8000-000000000004');
select pg_temp.assert_eq_int(pg_temp.sees('d5000000-0000-4000-8000-000000000005'), 0, 'cas 6a: D ne voit pas E (co-participants de C, jamais du même match)');
select pg_temp.assert_eq_int(pg_temp.sees('d5000000-0000-4000-8000-000000000001'), 0, 'cas 6b: D ne voit pas A');
reset role;

select pg_temp.act_as('d5000000-0000-4000-8000-000000000005');
select pg_temp.assert_eq_int(pg_temp.sees('d5000000-0000-4000-8000-000000000004'), 0, 'cas 6c: E ne voit pas D (les lignes NULL de MPub n''ouvrent rien)');
reset role;

-- ----------------------------------------------------------------------------
-- Cas 7 — son propre profil, toujours accessible (F n'a AUCUN lien : seule
-- la branche id = auth.uid() de la policy joue) ; update self toujours
-- permis (les policies d'écriture ne sont pas touchées par la migration).
-- ----------------------------------------------------------------------------

select pg_temp.act_as('d5000000-0000-4000-8000-000000000006');
select pg_temp.assert_eq_int(pg_temp.sees('d5000000-0000-4000-8000-000000000006'), 1, 'cas 7a: F voit son propre profil');
update public.profiles
   set display_name = 'pvc-f-' || substring(id::text, 1, 8)
 where id = 'd5000000-0000-4000-8000-000000000006';
select pg_temp.assert_eq_text(
  pg_temp.seen_name('d5000000-0000-4000-8000-000000000006'),
  'pvc-f-d5000000',
  'cas 7b: update self toujours permis (policies d''écriture non touchées)');
reset role;

-- ----------------------------------------------------------------------------
-- Récapitulatif lisible : matrice de visibilité vue par D puis par F.
-- ----------------------------------------------------------------------------

select pg_temp.act_as('d5000000-0000-4000-8000-000000000004');
select 'D' as viewer,
  pg_temp.sees('d5000000-0000-4000-8000-000000000001') as voit_a,
  pg_temp.sees('d5000000-0000-4000-8000-000000000002') as voit_b,
  pg_temp.sees('d5000000-0000-4000-8000-000000000003') as voit_c,
  pg_temp.sees('d5000000-0000-4000-8000-000000000004') as voit_d,
  pg_temp.sees('d5000000-0000-4000-8000-000000000005') as voit_e,
  pg_temp.sees('d5000000-0000-4000-8000-000000000006') as voit_f;
reset role;

select pg_temp.act_as('d5000000-0000-4000-8000-000000000006');
select 'F' as viewer,
  pg_temp.sees('d5000000-0000-4000-8000-000000000001') as voit_a,
  pg_temp.sees('d5000000-0000-4000-8000-000000000002') as voit_b,
  pg_temp.sees('d5000000-0000-4000-8000-000000000003') as voit_c,
  pg_temp.sees('d5000000-0000-4000-8000-000000000004') as voit_d,
  pg_temp.sees('d5000000-0000-4000-8000-000000000005') as voit_e,
  pg_temp.sees('d5000000-0000-4000-8000-000000000006') as voit_f;
reset role;

select 'profile_visibility_check: OK — 7 cas verts (cas 8 = les 7 harnais existants rejoués séparément)' as result;

rollback;
