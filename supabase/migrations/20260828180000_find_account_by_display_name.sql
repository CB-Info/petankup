-- ============================================================================
-- 20260828180000_find_account_by_display_name
-- Pétankup — recherche d'un compte par pseudo (extraction).
--
-- Le manque : rien ne résolvait un pseudo en compte. La recherche vivait dans
-- private.invite_tournament_member_by_display_name (phase E), qui écrit un
-- membre dans la foulée. Le sélecteur de joueurs du match libre (H2.b) a
-- besoin de la recherche seule : on la sort de sa cachette.
--
-- Contenu :
--   Bloc 1 : private.find_account_by_display_name — la règle de recherche.
--   Bloc 2 : wrapper public.find_account_by_display_name (PostgREST).
--   Bloc 3 : private.invite_tournament_member_by_display_name — corps repris
--            VERBATIM de phase E, seul le bloc de recherche (étape 4) est
--            remplacé par un appel à la règle partagée. Une règle, un endroit,
--            deux consommateurs. Aucun comportement observable ne change.
--   Bloc 4 : assertions finales.
--
-- La règle :
--   - correspondance EXACTE après normalisation lower(trim(…)) — la même que
--     l'index unique profiles_display_name_lower_idx (D.1) : un pseudo
--     trouvable à la création est trouvable à la recherche, et réciproquement ;
--   - renvoie l'identifiant du compte et le pseudo tel qu'enregistré (casse
--     canonique), une ligne au plus (unicité D.1) ;
--   - aucune écriture ; réservée aux authentifiés (not_authenticated) ;
--   - l'absence n'est PAS une erreur : ensemble vide (l'interface en déduit
--     un joueur libre). Chaîne vide, blanche ou NULL → ensemble vide ;
--   - un utilisateur qui cherche son propre pseudo se trouve.
--
-- Ce que la fonction ne permet PAS (vérifié par le harnais) :
--   - lister ou parcourir les comptes : une entrée = un pseudo complet, une
--     sortie = 0 ou 1 ligne, jamais de liste ;
--   - une recherche par fragment, préfixe ou approximation : égalité stricte
--     sur la forme normalisée, aucun LIKE ;
--   - apprendre autre chose qu'« il existe / il n'existe pas » sur un pseudo.
--
-- Risque accepté (non traité, roadmap Horizon 3) : un authentifié peut tester
-- des pseudos un par un pour découvrir lesquels existent — énumération lente,
-- sans listage. À re-trancher à l'ouverture publique (limitation de débit,
-- ou liste d'amis qui rend la recherche inutile).
--
-- La RLS des profils (soi + co-tournoi) n'est PAS modifiée : la fonction la
-- contourne de façon contrôlée (DEFINER), pour une égalité exacte seulement.
-- Idempotent (create or replace ; grants rejouables).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bloc 1 : la règle de recherche.
-- ----------------------------------------------------------------------------

create or replace function private.find_account_by_display_name(p_display_name text)
returns table (user_id uuid, display_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;

  -- Égalité sur l'expression de l'index unique D.1 : même normalisation,
  -- au plus une ligne. Une entrée vide, blanche ou NULL ne correspond à
  -- aucun profil (pseudo CHECK 1..50) : ensemble vide, sans erreur.
  return query
    select p.id, p.display_name
      from public.profiles p
     where lower(trim(p.display_name)) = lower(trim(p_display_name));
end;
$$;

revoke all on function private.find_account_by_display_name(text) from public;
grant execute on function private.find_account_by_display_name(text) to authenticated;

-- ----------------------------------------------------------------------------
-- Bloc 2 : wrapper public — exposé via PostgREST (0 ou 1 ligne).
-- ----------------------------------------------------------------------------

create or replace function public.find_account_by_display_name(p_display_name text)
returns table (user_id uuid, display_name text)
language sql
security invoker
set search_path = ''
as $$
  select account.user_id, account.display_name
    from private.find_account_by_display_name(p_display_name) as account;
$$;

revoke all on function public.find_account_by_display_name(text) from public;
revoke all on function public.find_account_by_display_name(text) from anon;
grant execute on function public.find_account_by_display_name(text) to authenticated;

comment on function public.find_account_by_display_name(text) is
  'Resolves a display name to an account: exact match after the same normalisation used for display-name uniqueness (lower(trim)), returns at most one row (user_id, canonical display_name). No write, no listing, no partial search; a missing name returns no row. Raises not_authenticated for anonymous callers.';

-- ----------------------------------------------------------------------------
-- Bloc 3 : l'invitation consomme la règle partagée. Corps repris VERBATIM de
-- phase E (20260608153728, l.38-118) ; seul l'ancien bloc 4 (join profiles ×
-- auth.users sur lower(trim)) est remplacé : recherche via la règle, puis
-- email de l'invité pour le snapshot member_email. Gates, ordre, codes
-- d'erreur, wrapper public et grants inchangés (ACL préservée par le replace).
-- ----------------------------------------------------------------------------

create or replace function private.invite_tournament_member_by_display_name(
  p_tournament_id uuid,
  p_display_name text
)
returns public.tournament_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_invitee_id uuid;
  v_invitee_email text;
  v_inserted public.tournament_members;
begin
  -- 1. Identité du caller
  v_caller_id := (select auth.uid());
  if v_caller_id is null then
    raise exception 'not_authenticated';
  end if;

  -- 2. Vérification owner du tournoi
  if not exists (
    select 1
      from public.tournaments t
     where t.id = p_tournament_id
       and t.owner_id = v_caller_id
  ) then
    raise exception 'not_owner';
  end if;

  -- 3. Tournoi non terminé. Position APRÈS le check owner pour ne pas
  -- leaker le status à un non-owner (qui doit recevoir 'not_owner').
  if exists (
    select 1
      from public.tournaments t
     where t.id = p_tournament_id
       and t.status = 'completed'
  ) then
    raise exception 'tournament_completed';
  end if;

  -- 4. Lookup de l'invité par pseudo : règle de recherche partagée
  -- (private.find_account_by_display_name — même normalisation que
  -- l'unicité D.1, correspondance exacte). member_email est ensuite
  -- récupéré depuis auth.users pour le snapshot d'invitation.
  select account.user_id
    into v_invitee_id
    from private.find_account_by_display_name(p_display_name) as account;
  if v_invitee_id is null then
    raise exception 'display_name_not_found';
  end if;
  select u.email
    into v_invitee_email
    from auth.users u
   where u.id = v_invitee_id;

  -- 5. Refus auto-invitation
  if v_invitee_id = v_caller_id then
    raise exception 'self_invite';
  end if;

  -- 6. INSERT, en interceptant la contrainte unique (tournament_id, user_id)
  begin
    insert into public.tournament_members (tournament_id, user_id, member_email)
    values (p_tournament_id, v_invitee_id, v_invitee_email)
    returning * into v_inserted;
  exception
    when unique_violation then
      raise exception 'already_member';
  end;

  return v_inserted;
end;
$$;

-- ----------------------------------------------------------------------------
-- Bloc 4 : assertions finales — toute anomalie annule la migration.
-- ----------------------------------------------------------------------------

do $$
declare
  lookup_is_consistent boolean;
  wrapper_is_consistent boolean;
  invite_is_consistent boolean;
  anon_can_execute_wrapper boolean;
begin
  select p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%'
    into lookup_is_consistent
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'find_account_by_display_name';

  select not p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%'
    into wrapper_is_consistent
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'find_account_by_display_name';

  select p.prosecdef
         and p.prosrc like '%private.find_account_by_display_name(p_display_name)%'
         and p.prosrc not like '%join auth.users u on u.id = p.id%'
    into invite_is_consistent
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'invite_tournament_member_by_display_name';

  select has_function_privilege('anon', 'public.find_account_by_display_name(text)', 'EXECUTE')
    into anon_can_execute_wrapper;

  if lookup_is_consistent is distinct from true then
    raise exception 'find_account: private.find_account_by_display_name incohérente (security definer / search_path)';
  end if;
  if wrapper_is_consistent is distinct from true then
    raise exception 'find_account: public.find_account_by_display_name incohérente (doit être INVOKER avec search_path)';
  end if;
  if invite_is_consistent is distinct from true then
    raise exception 'find_account: l''invitation ne consomme pas la règle partagée (ou a perdu security definer)';
  end if;
  if anon_can_execute_wrapper then
    raise exception 'find_account: anon ne doit pas pouvoir exécuter le wrapper';
  end if;
end;
$$;
