-- ============================================================================
-- 20260904120000_profile_privacy_owner_access
-- Pétankup — les deux capacités que l'interface de confidentialité (ticket
-- A4) a signalées manquantes à son étape 0.
--
-- Source de vérité : docs/spec_amitie_confidentialite.md (C1, C5, C6) et
-- docs/conception_amitie_confidentialite.md (P3-P4, §4.4).
--
-- Le manque : A2 (20260902100000) protège le CONTENU d'un profil et masque
-- la colonne profiles.visibility à toute lecture directe (grant SELECT par
-- colonne — arbitrage 1 : personne n'énumère qui est privé). Deux choses
-- ont été laissées, à dessein, au ticket d'interface :
--   1. lire SON propre réglage — aucun chemin n'existe : la colonne n'est pas
--      sélectionnable, get_user_profile(soi) rend toujours la forme complète
--      (branche propriétaire de la règle) sans jamais émettre visibility ;
--   2. l'aperçu extérieur (C6) — voir son profil tel qu'un tiers le voit :
--      aucune fonction n'accepte de demander cette composition. Le
--      commentaire de la règle A2 l'annonce : « the outside preview (C6) will
--      request the restricted composition explicitly instead of tricking
--      this rule ».
--
-- Contenu :
--   Bloc 1 : private.get_my_profile() + wrapper public — la ligne de
--            l'appelant AVEC son réglage, résolue sur auth.uid(). La colonne
--            reste masquée pour tout autre lecteur (arbitrage 1 intact).
--   Bloc 2 : private.profile_content_is_visible_to_strangers — une SECONDE
--            règle nommée (« le contenu complet est-il visible d'un tiers
--            quelconque ? » = profil public). La règle A2
--            profile_content_is_visible_to_current_user n'est PAS touchée :
--            signature, corps, grants, commentaire — chaque règle garde un
--            nom qui dit ce qu'elle répond.
--   Bloc 3 : get_user_profile(p_user_id, p_as_stranger default false) —
--            drop des signatures 1-arg (create or replace ne peut pas ajouter
--            un paramètre : il créerait une SURCHARGE et PostgREST répondrait
--            PGRST203), recréation en 2-arg. p_as_stranger est RÉSERVÉ AU
--            PROPRIÉTAIRE (not_owner sinon) ; la réponse est composée par la
--            règle « tiers » ; dans la branche complète, une entrée du journal
--            n'est ouvrable que si l'OBJET est public — exactement ce que voit
--            un tiers qui n'est ni membre ni participant. L'appel par défaut
--            reste byte-identique à A2.
--   Bloc 4 : assertions finales.
--
-- Décisions actées (revue adversariale du plan A4, 2026-09-04) :
--   - p_as_stranger RÉSERVÉ AU PROPRIÉTAIRE. Sans cette garde, tout
--     authentifié obtiendrait un oracle « X est-il privé ? » par la FORME de
--     la réponse (restreinte ou non) — y compris sur ses amis, dont le
--     contenu lui est pourtant visible — et, la table profiles étant
--     énumérable (policy profiles_select_authenticated), un recensement
--     complet des profils privés. Le seul usage légitime est l'aperçu de son
--     propre profil : la base le dit (raise 'not_owner', vocabulaire existant
--     des invitations), elle ne le laisse pas à l'interface.
--   - Une seconde règle plutôt qu'un paramètre sur la règle A2 : la règle A2
--     répond « le contenu est-il visible de l'appelant ? » et son commentaire
--     interdit de la « tromper » pour l'aperçu. La règle « tiers » répond une
--     autre question ; get_user_profile choisit l'une ou l'autre.
--   - Ouvrabilité en mode tiers = l'objet est public. Vérifié contre les
--     deux helpers d'objets : tournament_is_visible_to_current_user = owner
--     OU public OU membre ; free_match_is_visible_to_current_user = public
--     OU participant. Pour un tiers qui n'est rien de tout cela, il reste
--     exactement « public ». Le CASE existant vide déjà les participants
--     d'un match non ouvrable. Approximation assumée et documentée : un
--     non-ami qui serait membre d'un tournoi privé du propriétaire verrait,
--     lui, cette entrée ouvrable ; l'aperçu montre le tiers le moins
--     privilégié.
--   - DROP + CREATE remet l'ACL d'une fonction à EXECUTE TO PUBLIC et efface
--     son commentaire (create or replace les préserve, drop non) : chaque
--     fonction (re)créée ici reçoit son bloc complet revoke/grant + comment,
--     sur sa NOUVELLE signature — jamais de revoke sur une signature
--     supprimée (42883). Assertion has_function_privilege('anon', …) = false
--     en Bloc 4 pour rendre une régression détectable.
--   - get_my_profile en `returns table` (typé par le générateur en
--     Returns: {…}[] — précédent find_account_by_display_name) ; 0 ligne si
--     la ligne profiles manque (cas dégénéré, l'app garde son
--     « Profil introuvable. »).
--
-- Garde-fou : ne JAMAIS élargir le grant SELECT de profiles.visibility ni
-- ajouter visibility au sous-objet profile du bundle — le réglage ne sort
-- de la base que par get_my_profile (soi seul) et par le marqueur restricted.
--
-- Rappels : idempotente (create or replace, drop function if exists sur les
-- anciennes signatures, grants rejouables) ; search_path = '' ; AUCUN
-- fichier applicatif de comportement — gen:types dans ce commit (types
-- additifs : p_as_stranger optionnel, get_my_profile nouveau).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bloc 1 : get_my_profile — la ligne de l'appelant, avec son réglage.
-- ----------------------------------------------------------------------------

create or replace function private.get_my_profile()
returns table (
  id uuid,
  display_name text,
  created_at timestamptz,
  updated_at timestamptz,
  visibility public.profile_visibility
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;

  -- Résolue sur auth.uid(), jamais sur un paramètre : une ligne au plus, la
  -- sienne. DEFINER lit visibility, que l'appelant ne peut pas sélectionner.
  return query
    select p.id, p.display_name, p.created_at, p.updated_at, p.visibility
      from public.profiles p
     where p.id = (select auth.uid());
end;
$$;

revoke all on function private.get_my_profile() from public;
grant execute on function private.get_my_profile() to authenticated;

create or replace function public.get_my_profile()
returns table (
  id uuid,
  display_name text,
  created_at timestamptz,
  updated_at timestamptz,
  visibility public.profile_visibility
)
language sql
security invoker
set search_path = ''
as $$
  select mine.id, mine.display_name, mine.created_at, mine.updated_at, mine.visibility
    from private.get_my_profile() as mine;
$$;

revoke all on function public.get_my_profile() from public;
revoke all on function public.get_my_profile() from anon;
grant execute on function public.get_my_profile() to authenticated;

comment on function public.get_my_profile() is
  'Returns the caller''s own profile row (id, display_name, created_at, '
  'updated_at) together with its privacy setting (visibility). The only way '
  'a client can read that setting: the column stays masked from direct '
  'reads for everyone (A2, per-column SELECT grant), and the profile bundle '
  'never carries it. Resolved on auth.uid(), never on a parameter: at most '
  'one row, always the caller''s; no row if the profile row is missing. '
  'Raises typed error: not_authenticated.';

-- ----------------------------------------------------------------------------
-- Bloc 2 : la règle « tiers » — le contenu complet est-il visible d'un tiers
-- quelconque ? Une seconde règle nommée ; la règle A2 reste intacte.
-- ----------------------------------------------------------------------------

create or replace function private.profile_content_is_visible_to_strangers(profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Un tiers n'est ni le propriétaire ni un ami : seule la branche « profil
  -- public » de la règle A2 lui reste. EXISTS : jamais NULL, un id inexistant
  -- rend false (fail-closed, comme la règle A2).
  select exists (
    select 1
      from public.profiles p
     where p.id = profile_id
       and p.visibility = 'public'
  );
$$;

revoke all on function private.profile_content_is_visible_to_strangers(uuid) from public;
grant execute on function private.profile_content_is_visible_to_strangers(uuid) to authenticated;

comment on function private.profile_content_is_visible_to_strangers(uuid) is
  'The profile-content rule seen by a STRANGER (C6 outside preview): true iff '
  'the profile is public — a third party is neither the owner nor a friend, '
  'so only that branch of private.profile_content_is_visible_to_current_user '
  'remains. Never NULL (EXISTS), a non-existent id yields false. A second '
  'named rule rather than a parameter on the A2 rule, whose contract forbids '
  'tricking it for the preview. Consumer: private.get_user_profile when '
  'p_as_stranger is true (owner only). SECURITY DEFINER (reads visibility, '
  'masked from clients).';

-- ----------------------------------------------------------------------------
-- Bloc 3 : get_user_profile(p_user_id, p_as_stranger). Drop des signatures
-- 1-arg (wrapper d'abord), recréation en 2-arg avec grants et commentaires
-- réénoncés. Le corps est celui d'A2 (20260902100000) : seules les lignes
-- marquées [A4-pré] changent.
-- ----------------------------------------------------------------------------

drop function if exists public.get_user_profile(uuid);
drop function if exists private.get_user_profile(uuid);

create or replace function private.get_user_profile(
  p_user_id uuid,
  p_as_stranger boolean default false
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_content_is_visible boolean;
begin
  if v_caller is null then
    raise exception 'not_authenticated';
  end if;

  -- [A4-pré — début] L'aperçu extérieur est réservé au propriétaire : la
  -- FORME de la réponse (restreinte ou non) révélerait le réglage d'autrui.
  if p_as_stranger and p_user_id is distinct from v_caller then
    raise exception 'not_owner';
  end if;

  -- Le droit de l'appelant, calculé UNE fois, AVANT tout accès aux tables de
  -- stats et de journal. FAIL-CLOSED : le chemin complet n'est atteignable
  -- que le droit acquis. En aperçu, c'est la règle « tiers » qui répond.
  if p_as_stranger then
    v_content_is_visible := private.profile_content_is_visible_to_strangers(p_user_id);
  else
    v_content_is_visible := private.profile_content_is_visible_to_current_user(p_user_id);
  end if;
  -- [A4-pré — fin]

  -- [A2 — début]
  if not v_content_is_visible then
    -- Réponse restreinte (C4) : le pseudo seul + le marqueur. Les clés
    -- stats / results / free_matches / free_match_stats sont ABSENTES ;
    -- 'restricted' n'existe QUE dans cette réponse. La sous-requête profile
    -- est reprise VERBATIM de la réponse complète (pseudo À JOUR — on lit
    -- profiles, jamais un snapshot ; visibility n'y figure pas).
    if exists (select 1 from public.profiles where id = p_user_id) then
      return json_build_object(
        'profile', (
          select row_to_json(p) from (
            select id, display_name, created_at, updated_at
              from public.profiles
             where id = p_user_id
          ) p
        ),
        'restricted', true
      );
    end if;

    -- Id inexistant : forme vide HISTORIQUE en littéral, byte-identique à
    -- l'ancienne forme calculée (sous-requêtes vides), SANS marqueur —
    -- introuvable et masqué restent distinguables.
    return json_build_object(
      'profile', null,
      'stats', null,
      'results', '[]'::json,
      'free_matches', '[]'::json,
      'free_match_stats', null
    );
  end if;
  -- [A2 — fin] Tout ce qui suit est repris VERBATIM de 20260831100000, aux
  -- deux expressions viewer_can_open près ([A4-pré]).

  return json_build_object(
    'profile', (
      select row_to_json(p) from (
        select id, display_name, created_at, updated_at
          from public.profiles
         where id = p_user_id
      ) p
    ),
    'stats', (
      select row_to_json(s) from (
        select
          matches_played, wins, losses,
          points_scored, points_conceded,
          tournaments_played, tournaments_won, podiums,
          last_tournament_at
        from public.user_stats
        where user_id = p_user_id
      ) s
    ),
    'results', coalesce(
      (
        select json_agg(card order by card.tournament_completed_at desc)
        from (
          select
            r.tournament_id,
            t.name as tournament_name,
            t.date as tournament_date,
            r.tournament_completed_at,
            r.team_id,
            tm.name as team_name,
            r.wins,
            r.losses,
            r.points_scored,
            r.points_conceded,
            r.final_rank,
            r.is_winner,
            r.is_podium,
            -- [A4-pré] En aperçu, un tiers n'ouvre que les tournois PUBLICS
            -- (ni owner, ni membre) ; sinon le helper partagé, comme avant.
            case
              when p_as_stranger then t.visibility = 'public'
              else private.tournament_is_visible_to_current_user(r.tournament_id)
            end as viewer_can_open,
            (
              select coalesce(
                json_agg(
                  json_build_object(
                    'user_id', mate.user_id,
                    'display_name', mate.display_name
                  )
                  order by mate.display_name
                ),
                '[]'::json
              )
              from public.team_players mate
              where mate.team_id = r.team_id
                and (mate.user_id is distinct from p_user_id)
            ) as teammates
          from public.user_tournament_results r
          join public.tournaments t on t.id = r.tournament_id
          join public.teams tm on tm.id = r.team_id
          where r.user_id = p_user_id
        ) card
      ),
      '[]'::json
    ),
    -- [H2.c-1 — début] Les deux clés ajoutées ; tout ce qui précède est
    -- inchangé.
    'free_matches', coalesce(
      (
        select json_agg(
          json_build_object(
            'match_id', fm.id,
            'played_on', fm.played_on,
            'created_at', fm.created_at,
            'score_a', fm.score_a,
            'score_b', fm.score_b,
            'side', me.side,
            'viewer_can_open', viewer_access.viewer_can_open,
            'teammates', case when viewer_access.viewer_can_open then (
              select coalesce(
                json_agg(
                  json_build_object(
                    'user_id', mate.user_id,
                    'display_name', mate.display_name
                  )
                  order by mate.display_name
                ),
                '[]'::json
              )
              from public.free_match_players mate
              where mate.match_id = fm.id
                and mate.side = me.side
                and (mate.user_id is distinct from p_user_id)
            ) else '[]'::json end,
            'opponents', case when viewer_access.viewer_can_open then (
              select coalesce(
                json_agg(
                  json_build_object(
                    'user_id', opponent.user_id,
                    'display_name', opponent.display_name
                  )
                  order by opponent.display_name
                ),
                '[]'::json
              )
              from public.free_match_players opponent
              where opponent.match_id = fm.id
                and opponent.side <> me.side
            ) else '[]'::json end
          )
          order by fm.played_on desc, fm.created_at desc, fm.id desc
        )
        from public.free_match_players me
        join public.free_matches fm on fm.id = me.match_id
        -- Une seule évaluation du helper par match : elle décide le drapeau
        -- ET le contenu des deux listes (décision « divulgation »).
        -- [A4-pré] En aperçu, un tiers n'ouvre que les matchs PUBLICS (il
        -- n'est participant de rien) ; sinon le helper partagé, comme avant.
        cross join lateral (
          select case
            when p_as_stranger then fm.visibility = 'public'
            else private.free_match_is_visible_to_current_user(fm.id)
          end as viewer_can_open
        ) viewer_access
        where me.user_id = p_user_id
      ),
      '[]'::json
    ),
    'free_match_stats', (
      select row_to_json(s) from (
        select
          matches_played, wins, losses,
          points_scored, points_conceded
        from public.user_free_match_stats
        where user_id = p_user_id
      ) s
    )
    -- [H2.c-1 — fin]
  );
end;
$$;

revoke all on function private.get_user_profile(uuid, boolean) from public;
grant execute on function private.get_user_profile(uuid, boolean) to authenticated;

comment on function private.get_user_profile(uuid, boolean) is
  'Profile bundle composer (SECURITY DEFINER). The content gate is computed '
  'once, fail-closed, by one of two named rules: the caller''s own right '
  '(private.profile_content_is_visible_to_current_user) or, when '
  'p_as_stranger is true — owner only, not_owner otherwise — the right of a '
  'third party (private.profile_content_is_visible_to_strangers). In stranger '
  'mode a journal entry is openable only when its object is public. Exposed '
  'through the public INVOKER wrapper of the same signature.';

create or replace function public.get_user_profile(
  p_user_id uuid,
  p_as_stranger boolean default false
)
returns json
language sql
security invoker
set search_path = ''
as $$
  select private.get_user_profile(p_user_id, p_as_stranger);
$$;

revoke all on function public.get_user_profile(uuid, boolean) from public;
revoke all on function public.get_user_profile(uuid, boolean) from anon;
grant execute on function public.get_user_profile(uuid, boolean) to authenticated;

comment on function public.get_user_profile(uuid, boolean) is
  'Returns a JSON bundle for a user profile page. Content gate (A2): when '
  'the profile is public, or the caller is an accepted friend, or the '
  'caller is the owner (private.profile_content_is_visible_to_current_user), '
  'the full bundle { profile, stats, results, free_matches, free_match_stats } '
  'is returned. Otherwise a restricted answer { profile, restricted: true } '
  'carries the display name only — the stats/journal keys are ABSENT and '
  'never computed, so protected data never reaches the network. A '
  'non-existent id keeps the historical shape (profile null, empty lists, no '
  'marker) and stays distinguishable from a masked profile. Outside preview '
  '(C6): p_as_stranger = true, allowed on the caller''s OWN profile only '
  '(raises not_owner otherwise — the answer''s shape would otherwise disclose '
  'a third party''s setting), composes the answer as a stranger receives it: '
  'the content gate is private.profile_content_is_visible_to_strangers '
  '(public profile only) and, in the full bundle, journal entries open only '
  'when their tournament or match is public — a third party is neither a '
  'member nor a participant. The default call (p_as_stranger false) is '
  'unchanged from A2. The visibility setting itself is never exposed here '
  '(see get_my_profile). Raises typed errors: not_authenticated, not_owner.';

-- ----------------------------------------------------------------------------
-- Bloc 4 : assertions finales — toute anomalie annule la migration.
-- ----------------------------------------------------------------------------

do $$
declare
  old_signatures_are_gone boolean;
  profile_function_is_current boolean;
  wrapper_is_invoker boolean;
  my_profile_is_consistent boolean;
  my_profile_wrapper_is_invoker boolean;
  stranger_rule_is_consistent boolean;
  a2_rule_is_untouched boolean;
  anon_can_execute boolean;
  authenticated_can_execute boolean;
begin
  select to_regprocedure('private.get_user_profile(uuid)') is null
         and to_regprocedure('public.get_user_profile(uuid)') is null
         and to_regprocedure('private.get_user_profile(uuid, boolean)') is not null
         and to_regprocedure('public.get_user_profile(uuid, boolean)') is not null
    into old_signatures_are_gone;

  -- La garde propriétaire, la règle « tiers », les deux CASE d'aperçu, et
  -- le corps hérité intact (marqueurs A2 / H2.c-1).
  select p.prosecdef
         and 'search_path=""' = any(p.proconfig)
         and p.prosrc like '%not_owner%'
         and p.prosrc like '%profile_content_is_visible_to_strangers%'
         and p.prosrc like '%profile_content_is_visible_to_current_user%'
         and p.prosrc like '%when p_as_stranger then t.visibility = ''public''%'
         and p.prosrc like '%when p_as_stranger then fm.visibility = ''public''%'
         and p.prosrc like '%''restricted'', true%'
         and p.prosrc like '%[H2.c-1 — début]%'
         and p.prosrc like '%[H2.c-1 — fin]%'
         and p.prosrc like '%user_free_match_stats%'
    into profile_function_is_current
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'get_user_profile';

  select not p.prosecdef
    into wrapper_is_invoker
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_user_profile';

  select p.prosecdef
         and 'search_path=""' = any(p.proconfig)
         and p.prosrc like '%not_authenticated%'
         and p.prosrc like '%p.id = (select auth.uid())%'
    into my_profile_is_consistent
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'get_my_profile';

  select not p.prosecdef
    into my_profile_wrapper_is_invoker
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_my_profile';

  select p.prosecdef
         and 'search_path=""' = any(p.proconfig)
         and p.prosrc like '%visibility = ''public''%'
    into stranger_rule_is_consistent
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'profile_content_is_visible_to_strangers';

  -- La règle A2 garde sa signature et ignore tout point de vue.
  select to_regprocedure('private.profile_content_is_visible_to_current_user(uuid)') is not null
         and to_regprocedure('private.profile_content_is_visible_to_current_user(uuid, boolean)') is null
         and not exists (
           select 1
             from pg_catalog.pg_proc p
             join pg_catalog.pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'private'
              and p.proname = 'profile_content_is_visible_to_current_user'
              and p.prosrc like '%stranger%'
         )
    into a2_rule_is_untouched;

  -- Le drop/create n'a pas laissé l'ACL par défaut (EXECUTE TO PUBLIC).
  select has_function_privilege('anon', 'public.get_user_profile(uuid, boolean)', 'EXECUTE')
         or has_function_privilege('anon', 'private.get_user_profile(uuid, boolean)', 'EXECUTE')
         or has_function_privilege('anon', 'public.get_my_profile()', 'EXECUTE')
         or has_function_privilege('anon', 'private.get_my_profile()', 'EXECUTE')
         or has_function_privilege('anon', 'private.profile_content_is_visible_to_strangers(uuid)', 'EXECUTE')
    into anon_can_execute;

  select has_function_privilege('authenticated', 'public.get_user_profile(uuid, boolean)', 'EXECUTE')
         and has_function_privilege('authenticated', 'public.get_my_profile()', 'EXECUTE')
    into authenticated_can_execute;

  if not old_signatures_are_gone then
    raise exception 'profile_privacy_owner_access: signatures de get_user_profile incohérentes (1-arg restante ou 2-arg absente)';
  end if;
  if profile_function_is_current is distinct from true then
    raise exception 'profile_privacy_owner_access: private.get_user_profile ne porte pas l''aperçu (ou a perdu le corps hérité)';
  end if;
  if wrapper_is_invoker is distinct from true then
    raise exception 'profile_privacy_owner_access: le wrapper public.get_user_profile doit rester INVOKER';
  end if;
  if my_profile_is_consistent is distinct from true then
    raise exception 'profile_privacy_owner_access: private.get_my_profile manque ou est incohérente';
  end if;
  if my_profile_wrapper_is_invoker is distinct from true then
    raise exception 'profile_privacy_owner_access: le wrapper public.get_my_profile doit être INVOKER';
  end if;
  if stranger_rule_is_consistent is distinct from true then
    raise exception 'profile_privacy_owner_access: la règle « tiers » manque ou est incohérente';
  end if;
  if not a2_rule_is_untouched then
    raise exception 'profile_privacy_owner_access: la règle A2 a été modifiée';
  end if;
  if anon_can_execute then
    raise exception 'profile_privacy_owner_access: anon a EXECUTE sur une fonction recréée (ACL non réénoncée)';
  end if;
  if not authenticated_can_execute then
    raise exception 'profile_privacy_owner_access: authenticated n''a pas EXECUTE sur les wrappers publics';
  end if;
end;
$$;
