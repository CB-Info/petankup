-- ============================================================================
-- 20260902100000_profile_privacy
-- Pétankup — la confidentialité du profil (ticket A2).
--
-- Source de vérité : docs/spec_amitie_confidentialite.md (C1-C7) et
-- docs/conception_amitie_confidentialite.md (P1-P4, §4.2-4.3).
--
-- Le manque : la page de profil doit devenir ouverte à tout utilisateur
-- connecté, avec un CONTENU protégé — bundle complet si profil public OU
-- appelant ami OU appelant propriétaire, sinon le pseudo seul. Aujourd'hui
-- private.get_user_profile (DEFINER) n'a AUCUNE gate hors not_authenticated :
-- un /profile/<uuid> tapé à la main renvoie déjà le bundle complet de
-- n'importe qui. L'ancienne règle « avoir joué ensemble »
-- (private.profile_is_visible_to_current_user, consommée par la seule policy
-- profiles_select_visible) ne protège en pratique que les lectures directes
-- de la table profiles. Ce ticket est donc, côté contenu, un DURCISSEMENT
-- (une gate là où il n'y en avait pas) ; l'« ouverture » ne concerne que la
-- policy de la table.
--
-- Contenu :
--   Bloc 1 : enum profile_visibility + colonne profiles.visibility
--            (not null default 'public') + grants par colonne réénoncés
--            (update ET select — cf. décisions).
--   Bloc 2 : la règle de visibilité du contenu, réutilisable —
--            private.profile_content_is_visible_to_current_user
--            (soi OU profil public OU amitié acceptée via friendships).
--   Bloc 3 : private.get_user_profile redéfinie — le droit calculé UNE fois
--            en tête, FAIL-CLOSED : la réponse complète n'est atteignable
--            que si le droit est acquis ; sinon réponse restreinte
--            { profile, restricted: true } si le profil existe, forme vide
--            historique sinon. La réponse autorisée est reprise VERBATIM de
--            20260831100000 (inchangée au caractère près). Le wrapper public
--            (INVOKER, phase I) est inchangé ; grants réénoncés, commentaire
--            catalogue réécrit.
--   Bloc 4 : suppression propre de l'ancienne règle — drop de
--            profiles_select_visible AVANT le drop du helper (la policy
--            référence la fonction par OID : drop function échouerait en
--            2BP01 ; jamais de cascade) ; nouvelle policy
--            profiles_select_authenticated (using (true)) créée dans la même
--            migration (la table est RLS-enabled : sans policy SELECT de
--            remplacement, deny-all — même getProfileById sur soi).
--   Bloc 5 : assertions finales.
--
-- Décisions actées (A2, arbitrages Clément du 2026-09-02) :
--   - DÉFAUT 'public' (C2/P2 : un nouveau compte est visible, le privé est
--     un choix délibéré) — divergence ASSUMÉE avec tournament_visibility et
--     free_match_visibility (défaut 'private') : ce n'est pas un
--     copier-collé raté. Le défaut sert le backfill des lignes existantes
--     (ADD COLUMN NOT NULL DEFAULT, fast default) et le trigger
--     handle_new_user_profile, qui n'insère que (id, display_name).
--   - Réglage modifiable par soi seul : grant update PAR COLONNE
--     (display_name, visibility) + policy profiles_update_self inchangée.
--   - LECTURE DIRECTE DE LA TABLE (arbitrage 1) : la policy s'ouvre
--     (using (true)) mais le grant select devient PAR COLONNE
--     (id, display_name, created_at, updated_at) — la colonne visibility
--     n'est PAS lisible en direct : un dump de la table n'énumère pas qui
--     est privé. Le réglage ne transite que par le marqueur restricted du
--     bundle (profil par profil), et la lecture de SON propre réglage sera
--     ouverte délibérément par le ticket d'interface. L'énumérabilité des
--     pseudos+dates par les authentifiés est assumée V1 (O1 : ouvrable
--     n'est pas trouvable — aucun annuaire dans l'app ;
--     find_account_by_display_name résout déjà tout pseudo exact) — à
--     re-trancher à l'ouverture publique.
--   - FRONTIÈRE DES OBJETS PUBLICS (arbitrage 2, R6 de la spec) : la
--     confidentialité du profil protège l'AGRÉGAT (la page de profil). Un
--     match libre PUBLIC ou un tournoi PUBLIC reste lisible avec ses
--     participants, même si l'un d'eux a un profil privé — c'est le modèle
--     de visibilité des objets, inchangé par A2 (spec §4/R5). Un tiers peut
--     donc reconstruire la part du journal d'un profil privé qui figure
--     dans des objets publics. Assumé, testé par le harnais (cas
--     frontière), inscrit en R6 dans la spec.
--   - Réponse restreinte : { profile, restricted: true }. Les clés stats /
--     results / free_matches / free_match_stats sont ABSENTES (pas vides ni
--     null) ; le marqueur restricted n'existe QUE dans cette réponse (la
--     réponse autorisée reste identique au caractère près — contrat
--     verrouillé par free_matches_in_profile_check cas 9a). La sous-requête
--     profile est reprise VERBATIM : un profil privé n'est pas une page
--     vide, le pseudo (à jour) reste lisible. visibility n'apparaît JAMAIS
--     dans bundle->'profile'.
--   - Un p_user_id INEXISTANT garde la forme historique { profile: null,
--     stats: null, results: [], free_matches: [], free_match_stats: null },
--     SANS marqueur, émise en LITTÉRAL (byte-identique à l'ancienne forme
--     calculée) : introuvable et masqué restent distinguables, et le chemin
--     complet n'est JAMAIS atteint sans droit (fail-closed — un id fantôme
--     dans les tables de stats sans ligne profiles, impossible aujourd'hui,
--     ne fuiterait rien).
--   - La règle vit dans un helper private.* (une règle, un endroit, §4.3),
--     JAMAIS NULL (branche « soi » enveloppée dans un EXISTS : un appelant
--     NULL rend false, fail-closed pour tout futur consommateur). Le test
--     d'amitié est l'EXISTS canonique de A1 : une ligne (least, greatest)
--     en statut 'accepted' — une demande pending n'ouvre RIEN. L'aperçu
--     extérieur (C6) ne passera PAS par ce helper : il demandera
--     explicitement la composition restreinte (ticket d'interface) — le
--     helper répond seulement « le contenu complet est-il visible ? ».
--   - Rectificatif de commentaires passés (on n'édite JAMAIS une migration
--     appliquée) : la phrase « la RLS des profils (soi + co-tournoi) n'est
--     pas modifiée » de 20260828180000 et la doctrine co-tournoi de
--     phase_c_1 sont rendues obsolètes par CETTE migration.
--
-- Garde-fou : ne JAMAIS poser de FK entre profiles et user_stats /
-- user_tournament_results / user_free_match_stats — elle ouvrirait la forme
-- d'embed PostgREST correspondante ; leur deny-total (privilèges + RLS sans
-- policy) reste la double couche, non touchée ici.
--
-- Rappels : idempotente (DO/EXCEPTION pour l'enum, add column if not exists,
-- create or replace, drop policy/function if exists, grants rejouables) ;
-- search_path = '' ; AUCUN fichier applicatif de comportement ; gen:types
-- INTERDIT dans ce ticket (la colonne durcirait ProfileRow et casserait 4
-- appels — c'est le ticket d'interface qui régénère ET adapte les
-- selects/mappers d'un même commit). Transition assumée : tant que
-- l'interface n'a pas suivi, un profil passé 'private' (possible uniquement
-- via l'API, aucune UI) affiche « Impossible de charger le profil » chez un
-- non-ami (le mapper exige la clé stats) — fenêtre vide en pratique : tous
-- les profils sont 'public'.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bloc 1 : enum + colonne + grants par colonne.
-- ----------------------------------------------------------------------------

do $$
begin
  create type public.profile_visibility as enum ('private', 'public');
exception
  when duplicate_object then null;
end $$;

alter table public.profiles
  add column if not exists visibility public.profile_visibility
    not null default 'public'::public.profile_visibility;

comment on column public.profiles.visibility is
  'Profile content privacy (A2, C1/C2): public (default — full profile bundle '
  'for any authenticated user) or private (display name only, unless the '
  'caller is an accepted friend or the owner). Consumed by '
  'private.profile_content_is_visible_to_current_user. The display name is '
  'never hidden. Writable by the owner only (profiles_update_self + '
  'per-column grant); NOT directly selectable by clients (per-column select '
  'grant) — the setting only surfaces through the bundle''s restricted '
  'marker.';

-- Grants par colonne réénoncés — on repart de zéro pour que l'état final
-- soit exact quel que soit l'état antérieur (premier cas du dépôt de grants
-- par colonne en SELECT) :
--   select : les 4 colonnes historiques, PAS visibility (arbitrage 1) —
--            l'app lit exactement ces colonnes (vérifié) ;
--   update : display_name + visibility (soi seul via profiles_update_self).
revoke select on table public.profiles from authenticated;
grant select (id, display_name, created_at, updated_at)
  on table public.profiles to authenticated;

revoke update on table public.profiles from authenticated;
grant update (display_name, visibility)
  on table public.profiles to authenticated;

-- ----------------------------------------------------------------------------
-- Bloc 2 : LA règle de visibilité du contenu — une règle, un endroit.
-- Ne couvre PAS l'existence du profil (l'appelant la traite à part) :
-- un id inexistant rend false (ni soi, ni public, ni ami). Jamais NULL.
-- ----------------------------------------------------------------------------

create or replace function private.profile_content_is_visible_to_current_user(profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Branche 1 : le propriétaire voit toujours son propre contenu. EXISTS
  -- et non une égalité nue : avec auth.uid() NULL, l'égalité vaudrait NULL
  -- et la fonction pourrait retourner NULL au lieu de false — un futur
  -- consommateur écrivant « if not helper(...) » échouerait OUVERT.
  select exists (
    select 1 where profile_id = (select auth.uid())
  )
  -- Branche 2 : profil public — contenu visible de tout authentifié (C3).
  or exists (
    select 1
      from public.profiles p
     where p.id = profile_id
       and p.visibility = 'public'
  )
  -- Branche 3 : amitié ACCEPTÉE (C4). Une ligne par duo en ordre
  -- déterministe (A1) : la paire (least, greatest) suffit, le sens de la
  -- demande est indifférent. status = 'accepted' : une demande pending
  -- n'ouvre rien. least/greatest ignorent NULL : appelant NULL → paire
  -- dégénérée low = high, impossible (contrainte ordered_pair stricte).
  or exists (
    select 1
      from public.friendships f
     where f.user_low_id = least(profile_id, (select auth.uid()))
       and f.user_high_id = greatest(profile_id, (select auth.uid()))
       and f.status = 'accepted'
  );
$$;

revoke all on function private.profile_content_is_visible_to_current_user(uuid) from public;
grant execute on function private.profile_content_is_visible_to_current_user(uuid) to authenticated;

comment on function private.profile_content_is_visible_to_current_user(uuid) is
  'THE profile-content rule (A2, conception §4.3): true iff the caller may '
  'see the full profile bundle — owner OR public profile OR an ACCEPTED '
  'friendship links them (one row per pair in deterministic order; a pending '
  'request opens nothing). Never NULL (the owner branch is wrapped in '
  'EXISTS): safe to negate. Does NOT check profile existence (a non-existent '
  'id yields false; callers handle not-found separately). First consumer: '
  'private.get_user_profile. Answers ONLY "is the full content visible?" — '
  'the outside preview (C6) will request the restricted composition '
  'explicitly instead of tricking this rule. SECURITY DEFINER (reads '
  'profiles / friendships as owner — friendships is deny-total); never call '
  'it from a policy of the tables it reads.';

-- ----------------------------------------------------------------------------
-- Bloc 3 : private.get_user_profile — la gate de contenu, calculée UNE fois,
-- FAIL-CLOSED. La réponse autorisée est le json_build_object de
-- 20260831100000, VERBATIM.
-- ----------------------------------------------------------------------------

create or replace function private.get_user_profile(p_user_id uuid)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is null then
    raise exception 'not_authenticated';
  end if;

  -- [A2 — début] Le droit de l'appelant, calculé UNE fois, AVANT tout accès
  -- aux tables de stats et de journal. FAIL-CLOSED : le chemin complet
  -- n'est atteignable que le droit acquis.
  if not private.profile_content_is_visible_to_current_user(p_user_id) then
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
  -- [A2 — fin] Tout ce qui suit est repris VERBATIM de 20260831100000.

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
            private.tournament_is_visible_to_current_user(r.tournament_id)
              as viewer_can_open,
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
        cross join lateral (
          select private.free_match_is_visible_to_current_user(fm.id)
            as viewer_can_open
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

-- Grants réénoncés (préservés par le create or replace, réaffirmés pour
-- rester explicites et idempotents) + commentaire du wrapper public réécrit
-- (le wrapper lui-même, INVOKER de phase I, est inchangé).

revoke all on function private.get_user_profile(uuid) from public;
grant execute on function private.get_user_profile(uuid) to authenticated;

revoke all on function public.get_user_profile(uuid) from public;
revoke all on function public.get_user_profile(uuid) from anon;
grant execute on function public.get_user_profile(uuid) to authenticated;

comment on function public.get_user_profile(uuid) is
  'Returns a JSON bundle for a user profile page. Content gate (A2): when '
  'the profile is public, or the caller is an accepted friend, or the '
  'caller is the owner (private.profile_content_is_visible_to_current_user), '
  'the full bundle { profile, stats, results, free_matches, free_match_stats } '
  'is returned, unchanged from before the gate. Otherwise a restricted '
  'answer { profile, restricted: true } carries the display name only — the '
  'stats/journal keys are ABSENT and never computed, so protected data '
  'never reaches the network. A non-existent id keeps the historical shape '
  '(profile null, empty lists, no marker) and stays distinguishable from a '
  'masked profile. Full-bundle semantics unchanged: stats from user_stats, '
  'results and free-match entries with viewer_can_open derived for the '
  'CALLER via the shared visibility helpers (participants of a private '
  'match are never disclosed), entries ordered as before. The visibility '
  'setting itself is never exposed. Raises typed error: not_authenticated.';

-- ----------------------------------------------------------------------------
-- Bloc 4 : suppression propre de l'ancienne règle et ouverture de la page.
-- Ordre imposé : la policy référence le helper par OID — drop policy
-- d'abord, drop function ensuite (jamais de cascade).
-- ----------------------------------------------------------------------------

drop policy if exists "profiles_select_visible" on public.profiles;

drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
  on public.profiles
  for select
  to authenticated
  using (true);

drop function if exists private.profile_is_visible_to_current_user(uuid);
-- Filet : l'ancien nom d'avant le rename de 20260901120000 (cas
-- pathologique où les deux noms coexisteraient — cf. son Bloc 1).
drop function if exists private.users_share_visible_tournament(uuid);

-- ----------------------------------------------------------------------------
-- Bloc 5 : assertions finales — toute anomalie annule la migration.
-- ----------------------------------------------------------------------------

do $$
declare
  enum_labels_are_expected boolean;
  column_is_consistent boolean;
  content_rule_is_consistent boolean;
  profile_function_is_current boolean;
  wrapper_is_invoker boolean;
  free_match_helper_still_exists boolean;
  old_rule_is_gone boolean;
  open_policy_is_in_place boolean;
  rls_is_enabled boolean;
  select_grants_are_columnar boolean;
  update_grants_are_columnar boolean;
  anon_has_any_privilege boolean;
begin
  select array_agg(e.enumlabel::text order by e.enumsortorder) = array['private', 'public']
    into enum_labels_are_expected
    from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    join pg_catalog.pg_enum e on e.enumtypid = t.oid
   where n.nspname = 'public' and t.typname = 'profile_visibility';

  select a.attnotnull and a.atthasdef
    into column_is_consistent
    from pg_catalog.pg_attribute a
   where a.attrelid = 'public.profiles'::regclass
     and a.attname = 'visibility';

  select p.prosecdef
         and 'search_path=""' = any(p.proconfig)
         and p.prosrc like '%public.friendships%'
         and p.prosrc like '%visibility = ''public''%'
    into content_rule_is_consistent
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and p.proname = 'profile_content_is_visible_to_current_user';

  -- La gate est en place ET les sections héritées n'ont pas disparu
  -- (ajout strict autour du corps verbatim).
  select p.prosecdef
         and 'search_path=""' = any(p.proconfig)
         and p.prosrc like '%profile_content_is_visible_to_current_user%'
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

  select to_regprocedure('private.free_match_is_visible_to_current_user(uuid)') is not null
    into free_match_helper_still_exists;

  select to_regprocedure('private.profile_is_visible_to_current_user(uuid)') is null
         and to_regprocedure('private.users_share_visible_tournament(uuid)') is null
         and not exists (
           select 1 from pg_catalog.pg_policy pol
            where pol.polrelid = 'public.profiles'::regclass
              and pol.polname = 'profiles_select_visible'
         )
    into old_rule_is_gone;

  select exists (
    select 1
      from pg_catalog.pg_policy pol
     where pol.polrelid = 'public.profiles'::regclass
       and pol.polname = 'profiles_select_authenticated'
       and pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) = 'true'
  ) into open_policy_is_in_place;

  select c.relrowsecurity
    into rls_is_enabled
    from pg_catalog.pg_class c
   where c.oid = 'public.profiles'::regclass;

  select     has_column_privilege('authenticated', 'public.profiles', 'id', 'SELECT')
         and has_column_privilege('authenticated', 'public.profiles', 'display_name', 'SELECT')
         and has_column_privilege('authenticated', 'public.profiles', 'created_at', 'SELECT')
         and has_column_privilege('authenticated', 'public.profiles', 'updated_at', 'SELECT')
         and not has_column_privilege('authenticated', 'public.profiles', 'visibility', 'SELECT')
    into select_grants_are_columnar;

  select     has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE')
         and has_column_privilege('authenticated', 'public.profiles', 'visibility', 'UPDATE')
         and not has_column_privilege('authenticated', 'public.profiles', 'id', 'UPDATE')
    into update_grants_are_columnar;

  select has_table_privilege('anon', 'public.profiles', 'SELECT, INSERT, UPDATE, DELETE')
         or has_column_privilege('anon', 'public.profiles', 'visibility', 'SELECT')
    into anon_has_any_privilege;

  if enum_labels_are_expected is distinct from true then
    raise exception 'profile_privacy: enum profile_visibility absent ou labels inattendus';
  end if;
  if column_is_consistent is distinct from true then
    raise exception 'profile_privacy: profiles.visibility doit être NOT NULL avec défaut';
  end if;
  if content_rule_is_consistent is distinct from true then
    raise exception 'profile_privacy: la règle de contenu manque ou est incohérente';
  end if;
  if profile_function_is_current is distinct from true then
    raise exception 'profile_privacy: get_user_profile ne porte pas la gate (ou a perdu le corps hérité)';
  end if;
  if wrapper_is_invoker is distinct from true then
    raise exception 'profile_privacy: le wrapper public.get_user_profile doit rester INVOKER';
  end if;
  if not free_match_helper_still_exists then
    raise exception 'profile_privacy: free_match_is_visible_to_current_user a disparu';
  end if;
  if not old_rule_is_gone then
    raise exception 'profile_privacy: l''ancienne règle d''accès subsiste (helper ou policy)';
  end if;
  if not open_policy_is_in_place then
    raise exception 'profile_privacy: profiles_select_authenticated absente ou non ouverte';
  end if;
  if rls_is_enabled is distinct from true then
    raise exception 'profile_privacy: la RLS doit rester activée sur profiles';
  end if;
  if select_grants_are_columnar is distinct from true then
    raise exception 'profile_privacy: grants SELECT par colonne incorrects (visibility doit être masquée)';
  end if;
  if update_grants_are_columnar is distinct from true then
    raise exception 'profile_privacy: grants UPDATE par colonne incorrects';
  end if;
  if anon_has_any_privilege then
    raise exception 'profile_privacy: anon ne doit avoir aucun privilège sur profiles';
  end if;
end;
$$;
