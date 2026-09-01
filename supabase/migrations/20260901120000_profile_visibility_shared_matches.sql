-- ============================================================================
-- 20260901120000_profile_visibility_shared_matches
-- Pétankup — visibilité des profils étendue aux matchs communs.
--
-- Le manque : la règle d'accès aux profils (policy profiles_select_visible,
-- phase_c_1) exige un tournoi commun. Deux joueurs qui n'ont partagé qu'un
-- match libre ne peuvent pas lire le profil l'un de l'autre — la page d'un
-- match libre affiche alors le pseudo figé (free_match_players.display_name)
-- au lieu du pseudo à jour. Règle corrigée : avoir joué ensemble ouvre
-- l'accès — tournoi (inchangé) OU match libre, public OU privé. La
-- visibilité du match reste une question distincte
-- (private.free_match_is_visible_to_current_user, non touchée).
--
-- Contenu :
--   Bloc 1 : rename idempotent de private.users_share_visible_tournament en
--            private.profile_is_visible_to_current_user (famille
--            X_is_visible_to_current_user du dépôt — le nom historique
--            devenait faux). La policy profiles_select_visible référence la
--            fonction par OID (FuncExpr.funcid dans polqual) : elle SUIT le
--            rename sans recréation ; pg_get_expr déparse le nouveau nom.
--   Bloc 2 : corps étendu — les deux branches tournoi reprises VERBATIM de
--            phase_c_1 (L152-190), une 3e branche AJOUTÉE (match libre
--            partagé), délimitée par des marqueurs. Ajout strict.
--   Bloc 3 : grants réénoncés + comment on function (nouveau nom).
--   Bloc 4 : assertions finales.
--
-- Décisions actées :
--   - L'extension vit DANS le helper, pas inline dans le using de la policy
--     (« une règle, un endroit », doctrine free_match_schema §3.3). Le
--     consommateur UNIQUE du helper est profiles_select_visible ; les RPC
--     (get_user_profile, find_account_by_display_name) contournent la RLS
--     en DEFINER et ne sont pas concernées.
--   - Seuls les participants LIÉS À UN COMPTE créent le lien : NULL = x est
--     faux en SQL, un joueur libre ne matche jamais ; les IS NOT NULL
--     explicites documentent la règle et épousent les index partiels
--     (WHERE user_id is not null).
--   - free_matches n'est PAS lue : un match privé lie autant qu'un public,
--     le camp est indifférent (auto-jointure sur match_id seul).
--   - AUCUN index à créer : l'EXISTS est servi par
--     free_match_players_user_id_idx (partiel, côté cible) et l'unique
--     free_match_players_one_per_user_per_match (match_id, user_id — côté
--     appelant via la jointure). Résister à la tentation d'en ajouter un.
--   - Le helper ne couvre PAS le cas « soi-même » : la branche
--     id = (select auth.uid()) reste séparée dans la policy (inchangée).
--
-- Anti-récursion (démontré) : aucune policy du dépôt ne lit profiles. Le
-- helper est SECURITY DEFINER propriété postgres et aucune table n'est en
-- FORCE ROW LEVEL SECURITY : sa lecture de free_match_players ne déclenche
-- pas la RLS de free_match_players. L'erreur 42P17 ne survient que si une
-- policy lit sa propre table SOUS RLS (doctrine free_match_schema, L55-62).
-- L'invariant de phase_c_1 (L25-30) tient et S'ÉTEND : aucune policy de
-- tournaments / teams / tournament_matches / team_players /
-- tournament_members / free_matches / free_match_players ne doit dépendre
-- de profiles — à re-vérifier à chaque ajout de policy sur ces tables.
--
-- Rappels : idempotente (rename conditionnel + create or replace, grants
-- rejouables) ; search_path = '' ; aucun fichier applicatif, aucune table ni
-- donnée touchée ; gen:types inutile (le helper vit en private, aucune
-- signature exposée à PostgREST ne change).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bloc 1 : rename idempotent. No-op si déjà renommée ; si les deux noms
-- coexistaient (anomalie), on ne renomme pas et l'assertion finale
-- « ancien nom disparu » fait échouer la migration bruyamment plutôt que
-- de diverger en silence.
-- ----------------------------------------------------------------------------

do $$
begin
  if to_regprocedure('private.users_share_visible_tournament(uuid)') is not null
     and to_regprocedure('private.profile_is_visible_to_current_user(uuid)') is null
  then
    alter function private.users_share_visible_tournament(uuid)
      rename to profile_is_visible_to_current_user;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- Bloc 2 : corps étendu. Branches 1 et 2 VERBATIM de phase_c_1 ; branche 3
-- ajoutée entre les marqueurs.
-- ----------------------------------------------------------------------------

create or replace function private.profile_is_visible_to_current_user(profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Branche 1 : profile_id est OWNER d'un tournoi t.
  -- Current user peut le voir si owner de t, OU public, OU membre.
  -- C'est cette branche qui autorise "Tournoi de Alice" sur les
  -- cartes publiques pour D non-invité.
  select exists (
    select 1
      from public.tournaments t
     where t.owner_id = profile_id
       and (
         t.owner_id = (select auth.uid())
         or t.visibility = 'public'
         or exists (
           select 1
             from public.tournament_members m
            where m.tournament_id = t.id
              and m.user_id = (select auth.uid())
         )
       )
  )
  -- Branche 2 : profile_id est MEMBRE d'un tournoi t.
  -- Current user peut le voir si owner de t OU membre de t.
  -- PAS si simple visiteur public — c'est ici qu'on coupe la fuite.
  or exists (
    select 1
      from public.tournament_members target_m
      inner join public.tournaments t
        on t.id = target_m.tournament_id
     where target_m.user_id = profile_id
       and (
         t.owner_id = (select auth.uid())
         or exists (
           select 1
             from public.tournament_members caller_m
            where caller_m.tournament_id = t.id
              and caller_m.user_id = (select auth.uid())
         )
       )
  )
  -- [matchs-communs — début]
  -- Branche 3 : profile_id et l'appelant ont participé, avec leur compte,
  -- au MÊME match libre — camp et visibilité indifférents (free_matches
  -- n'est pas lue : un match privé lie autant qu'un public ; qui peut
  -- OUVRIR le match reste l'affaire de free_match_is_visible_to_current_
  -- user). Les IS NOT NULL sont redondants avec les égalités (NULL = x
  -- est faux) mais explicitent « seuls les participants à compte lient »
  -- et épousent les index partiels WHERE user_id is not null.
  or exists (
    select 1
      from public.free_match_players target_p
      inner join public.free_match_players caller_p
        on caller_p.match_id = target_p.match_id
     where target_p.user_id is not null
       and target_p.user_id = profile_id
       and caller_p.user_id is not null
       and caller_p.user_id = (select auth.uid())
  );
  -- [matchs-communs — fin]
$$;

-- ----------------------------------------------------------------------------
-- Bloc 3 : grants réénoncés (préservés par le rename et le replace,
-- réaffirmés pour rester explicites et idempotents) + commentaire catalogue
-- (la fonction n'en avait jamais eu).
-- ----------------------------------------------------------------------------

revoke all on function private.profile_is_visible_to_current_user(uuid) from public;
grant execute on function private.profile_is_visible_to_current_user(uuid) to authenticated;

comment on function private.profile_is_visible_to_current_user(uuid) is
  'RLS helper for public.profiles (sole consumer: policy profiles_select_visible). '
  'True iff the given profile belongs to someone the caller has played with: '
  'shared tournament (owner/member semantics of phase_c_1 — a mere visitor of a '
  'public tournament only sees the owner) OR shared free match (account-backed '
  'participants only; side and match visibility are irrelevant — who may open '
  'the match stays with free_match_is_visible_to_current_user). Does NOT cover '
  'self: the policy keeps a separate id = auth.uid() branch. SECURITY DEFINER '
  '(the owner bypasses RLS on the tables it reads — no recursion); never call '
  'it from a policy of the tables it reads. Renamed from '
  'users_share_visible_tournament (matchs-communs, 20260901120000).';

-- ----------------------------------------------------------------------------
-- Bloc 4 : assertions finales — toute anomalie annule la migration.
-- ----------------------------------------------------------------------------

do $$
declare
  helper_is_consistent boolean;
  helper_body_is_current boolean;
  old_name_is_gone boolean;
  authenticated_can_execute boolean;
  anon_can_execute boolean;
  policy_uses_helper boolean;
begin
  -- search_path = '' est stocké avec l'élément vide CITÉ : search_path="".
  select p.prosecdef and ('search_path=""' = any(p.proconfig))
    into helper_is_consistent
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and p.proname = 'profile_is_visible_to_current_user';

  -- Ajout strict : la branche match libre est là ET les branches tournoi
  -- n'ont pas disparu.
  select p.prosrc like '%public.free_match_players%'
         and p.prosrc like '%public.tournament_members%'
         and p.prosrc like '%public.tournaments%'
    into helper_body_is_current
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and p.proname = 'profile_is_visible_to_current_user';

  select to_regprocedure('private.users_share_visible_tournament(uuid)') is null
    into old_name_is_gone;

  select has_function_privilege('authenticated',
           'private.profile_is_visible_to_current_user(uuid)', 'EXECUTE')
    into authenticated_can_execute;
  select has_function_privilege('anon',
           'private.profile_is_visible_to_current_user(uuid)', 'EXECUTE')
    into anon_can_execute;

  -- La policy a suivi le rename : son using, déparsé, porte le nouveau nom.
  select exists (
    select 1
      from pg_catalog.pg_policy pol
      join pg_catalog.pg_class c on c.oid = pol.polrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'profiles'
       and pol.polname = 'profiles_select_visible'
       and pg_catalog.pg_get_expr(pol.polqual, pol.polrelid)
             like '%profile_is_visible_to_current_user%'
  ) into policy_uses_helper;

  if helper_is_consistent is distinct from true then
    raise exception 'profile_visibility_shared_matches: helper incohérent (security definer / search_path)';
  end if;
  if helper_body_is_current is distinct from true then
    raise exception 'profile_visibility_shared_matches: le corps du helper ne porte pas la branche match libre (ou a perdu les branches tournoi)';
  end if;
  if not old_name_is_gone then
    raise exception 'profile_visibility_shared_matches: users_share_visible_tournament existe encore (rename non appliqué — les deux noms coexistent ?)';
  end if;
  if not authenticated_can_execute then
    raise exception 'profile_visibility_shared_matches: authenticated doit pouvoir exécuter le helper';
  end if;
  if anon_can_execute then
    raise exception 'profile_visibility_shared_matches: anon ne doit pas pouvoir exécuter le helper';
  end if;
  if not policy_uses_helper then
    raise exception 'profile_visibility_shared_matches: profiles_select_visible absente ou son using ne référence pas le helper renommé';
  end if;
end;
$$;
