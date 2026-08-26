-- ============================================================================
-- viewer_can_open_check.sql — vérification manuelle du booléen
-- viewer_can_open des entrées du journal (migration 20260826100000).
--
-- HORS CI : à exécuter à la main dans le SQL Editor de Supabase Studio (ou
-- psql sur la stack locale). Tout est encadré par begin/rollback : aucune
-- ligne ne reste en base.
--
-- Décor : A possède 3 tournois terminés (il y a joué) —
--   T1 public          (B n'y est rien)      → B peut ouvrir : TRUE
--   T2 privé           (B n'y est rien)      → B peut ouvrir : FALSE
--   T3 privé, B membre (et joueur adverse)   → B peut ouvrir : TRUE (D1)
-- Sur son propre profil, A peut tout ouvrir (owner).
--
-- Simulation d'identité : request.jwt.claims via set_config (les claims
-- traversent le DEFINER — auth.uid() = l'appelant simulé).
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- Helpers d'assertion.
-- ----------------------------------------------------------------------------

create function pg_temp.assert_can_open(
  p_profile uuid,
  p_tournament uuid,
  p_expected boolean,
  p_label text
) returns void
language plpgsql
as $$
declare
  v_actual boolean;
begin
  select (card->>'viewer_can_open')::boolean
    into v_actual
    from json_array_elements(public.get_user_profile(p_profile)->'results') card
   where card->>'tournament_id' = p_tournament::text;

  if v_actual is null then
    raise exception '[%] aucune entrée de journal pour le tournoi %',
      p_label, p_tournament;
  end if;
  if v_actual is distinct from p_expected then
    raise exception '[%] viewer_can_open attendu %, obtenu %',
      p_label, p_expected, v_actual;
  end if;
end;
$$;

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

-- ----------------------------------------------------------------------------
-- Fixtures (en postgres : bypass RLS, comme les autres harnais).
-- A joue seul dans son équipe, sauf T1 où un joueur libre l'accompagne
-- (non-régression du sous-select teammates). L'adversaire est une équipe
-- de joueurs libres, sauf T3 où B y joue (membre + joueur).
-- ----------------------------------------------------------------------------

insert into auth.users (id, email, aud, role, created_at, updated_at) values
  ('c0000000-0000-4000-8000-000000000001', 'viewer-a@petankup.test', 'authenticated', 'authenticated', now(), now()),
  ('c0000000-0000-4000-8000-000000000002', 'viewer-b@petankup.test', 'authenticated', 'authenticated', now(), now());

insert into public.tournaments (id, owner_id, name, date, status, visibility) values
  ('f2000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'vco-public',        current_date, 'draft', 'public'),
  ('f2000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'vco-prive-ferme',   current_date, 'draft', 'private'),
  ('f2000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'vco-prive-partage', current_date, 'draft', 'private');

-- B est membre de T3 (posé AVANT complétion : le gel des membres
-- s'applique aux tournois terminés).
insert into public.tournament_members (tournament_id, user_id, member_email) values
  ('f2000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000002', 'viewer-b@petankup.test');

insert into public.teams (id, tournament_id, name) values
  ('a2222222-2222-4222-8222-000000000001', 'f2000000-0000-4000-8000-000000000001', 'Alpha'),
  ('b2222222-2222-4222-8222-000000000001', 'f2000000-0000-4000-8000-000000000001', 'Bravo'),
  ('a2222222-2222-4222-8222-000000000002', 'f2000000-0000-4000-8000-000000000002', 'Alpha'),
  ('b2222222-2222-4222-8222-000000000002', 'f2000000-0000-4000-8000-000000000002', 'Bravo'),
  ('a2222222-2222-4222-8222-000000000003', 'f2000000-0000-4000-8000-000000000003', 'Alpha'),
  ('b2222222-2222-4222-8222-000000000003', 'f2000000-0000-4000-8000-000000000003', 'Bravo');

insert into public.team_players (team_id, tournament_id, user_id, display_name) values
  -- T1 : A + un joueur libre (teammates non vide pour la non-régression)
  ('a2222222-2222-4222-8222-000000000001', 'f2000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'viewer-a'),
  ('a2222222-2222-4222-8222-000000000001', 'f2000000-0000-4000-8000-000000000001', null, 'Libre Un'),
  ('b2222222-2222-4222-8222-000000000001', 'f2000000-0000-4000-8000-000000000001', null, 'Libre Deux'),
  -- T2 : A seul contre un joueur libre
  ('a2222222-2222-4222-8222-000000000002', 'f2000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'viewer-a'),
  ('b2222222-2222-4222-8222-000000000002', 'f2000000-0000-4000-8000-000000000002', null, 'Libre Trois'),
  -- T3 : A contre B (B membre ET joueur)
  ('a2222222-2222-4222-8222-000000000003', 'f2000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'viewer-a'),
  ('b2222222-2222-4222-8222-000000000003', 'f2000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000002', 'viewer-b');

insert into public.matches (tournament_id, team_a_id, team_b_id, score_a, score_b, winner_id, status, round_number) values
  ('f2000000-0000-4000-8000-000000000001', 'a2222222-2222-4222-8222-000000000001', 'b2222222-2222-4222-8222-000000000001', 13, 7, 'a2222222-2222-4222-8222-000000000001', 'completed', 1),
  ('f2000000-0000-4000-8000-000000000002', 'a2222222-2222-4222-8222-000000000002', 'b2222222-2222-4222-8222-000000000002', 13, 5, 'a2222222-2222-4222-8222-000000000002', 'completed', 1),
  ('f2000000-0000-4000-8000-000000000003', 'a2222222-2222-4222-8222-000000000003', 'b2222222-2222-4222-8222-000000000003', 13, 9, 'a2222222-2222-4222-8222-000000000003', 'completed', 1);

-- Complétion (matérialise les entrées de journal de A — et de B pour T3).
update public.tournaments set status = 'completed'
 where id in ('f2000000-0000-4000-8000-000000000001',
              'f2000000-0000-4000-8000-000000000002',
              'f2000000-0000-4000-8000-000000000003');

-- ----------------------------------------------------------------------------
-- Cas 1-3 — B visite le profil de A.
-- ----------------------------------------------------------------------------

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c0000000-0000-4000-8000-000000000002',
                    'role', 'authenticated')::text,
  true);

select pg_temp.assert_can_open(
  'c0000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001',
  true, 'cas 1: tournoi public → ouvrable par B');

select pg_temp.assert_can_open(
  'c0000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000002',
  false, 'cas 2: tournoi privé étranger → non ouvrable par B');

select pg_temp.assert_can_open(
  'c0000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000003',
  true, 'cas 3: tournoi privé où B a participé → ouvrable par B (D1)');

-- ----------------------------------------------------------------------------
-- Cas 4 — A consulte son propre profil : tout est ouvrable (owner).
-- ----------------------------------------------------------------------------

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c0000000-0000-4000-8000-000000000001',
                    'role', 'authenticated')::text,
  true);

select pg_temp.assert_can_open(
  'c0000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001',
  true, 'cas 4a: propre profil, public');
select pg_temp.assert_can_open(
  'c0000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000002',
  true, 'cas 4b: propre profil, privé fermé');
select pg_temp.assert_can_open(
  'c0000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000003',
  true, 'cas 4c: propre profil, privé partagé');

-- ----------------------------------------------------------------------------
-- Cas 5 — non-régression du reste du bundle (toujours claims = A).
-- ----------------------------------------------------------------------------

do $$
declare
  v_bundle json := public.get_user_profile('c0000000-0000-4000-8000-000000000001');
begin
  if v_bundle->'profile'->>'display_name' <> 'viewer-a' then
    raise exception '[cas 5] profile.display_name inattendu : %',
      v_bundle->'profile'->>'display_name';
  end if;
  perform pg_temp.assert_eq_int(
    (v_bundle->'stats'->>'tournaments_played')::int, 3,
    'cas 5: stats.tournaments_played');
  perform pg_temp.assert_eq_int(
    json_array_length(v_bundle->'results'), 3,
    'cas 5: nombre d''entrées du journal');
  -- Teammates : l'entrée T1 de A porte son coéquipier libre (snapshot).
  perform pg_temp.assert_eq_int(
    (
      select json_array_length(card->'teammates')
      from json_array_elements(v_bundle->'results') card
      where card->>'tournament_id' = 'f2000000-0000-4000-8000-000000000001'
    ), 1,
    'cas 5: teammates de T1 (joueur libre en snapshot)');
end $$;

-- Récapitulatif lisible avant rollback.
select card->>'tournament_name' as tournoi,
       card->>'viewer_can_open' as ouvrable_par_a
  from json_array_elements(
    public.get_user_profile('c0000000-0000-4000-8000-000000000001')->'results'
  ) card;

rollback;
