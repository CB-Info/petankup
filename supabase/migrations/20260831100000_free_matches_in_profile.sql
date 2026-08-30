-- ============================================================================
-- 20260831100000_free_matches_in_profile
-- Pétankup — Ticket H2.c-1 : les matchs libres dans le bundle de profil.
--
-- Le manque : private.get_user_profile ne connaît que les tournois
-- ({ profile, stats, results }). Le journal unifié et les compteurs
-- combinés (H2.c-2) ont besoin des matchs libres du joueur consulté et de
-- ses statistiques de match libre. Le drapeau « le visiteur peut ouvrir »
-- se calcule ICI, là où vit déjà la règle de visibilité — jamais côté client.
--
-- Contenu :
--   Bloc 1 : private.get_user_profile — corps repris VERBATIM de la version
--            précédente (viewer_can_open) ; deux clés AJOUTÉES en fin de
--            bundle : free_matches et free_match_stats. Ajout strict : les
--            trois clés existantes sont inchangées au caractère près, le
--            mapper applicatif actuel ignore les clés qu'il ne connaît pas.
--   Bloc 2 : grants réénoncés (idempotents) + commentaire du wrapper public.
--            Le wrapper lui-même (INVOKER, phase I) est inchangé.
--   Bloc 3 : assertions finales.
--
-- Décisions actées (H2.c-1) :
--   - Tableau SÉPARÉ free_matches (pas de liste fusionnée) : results reste
--     intact, deux formes homogènes côté application, la fusion
--     chronologique est un tri côté client (H2.c-2).
--   - Entrée de match libre : match_id, played_on, created_at, score_a,
--     score_b, side (camp du joueur consulté — son résultat s'en déduit :
--     gagnant ssi (side = 'A') = (score_a > score_b)), viewer_can_open,
--     teammates (même camp, lui-même exclu), opponents (autre camp).
--     Coéquipiers et adversaires = { user_id, display_name } triés par
--     pseudo, MÊME forme que les coéquipiers de tournoi ; user_id null =
--     joueur libre ou compte supprimé, display_name = pseudo figé.
--     created_at est le moment de l'enregistrement, pendant de
--     tournament_completed_at pour départager les égalités jour/jour dans
--     le journal unifié. Le format se déduit de l'effectif (camps
--     équilibrés garantis par create_free_match) : 1 + teammates.
--   - Ordre TOTAL : played_on desc, created_at desc, id desc — plusieurs
--     parties peuvent être notées le même jour ; id rend l'ordre
--     reproductible même à created_at égal.
--   - free_match_stats : { matches_played, wins, losses, points_scored,
--     points_conceded } tels quels, ou null quand le joueur n'a aucun match
--     libre (la table n'a pas de ligne dans ce cas — miroir exact de
--     stats, null sans tournoi terminé). Aucun total combiné : il se
--     calcule à la lecture (D3), jamais ici ni en base.
--   - Visibilité : viewer_can_open RÉUTILISE
--     private.free_match_is_visible_to_current_user (public OU participant
--     à compte), calculé pour l'APPELANT (auth.uid() traverse le DEFINER),
--     pas pour le propriétaire du profil. La visibilité brute (visibility,
--     created_by) n'est jamais exposée.
--   - Divulgation (décision du 2026-08-30) : le bundle n'a pas de gate
--     (décision Phase I) — l'entrée d'un match PRIVÉ que l'appelant ne peut
--     pas ouvrir garde date, scores et camp du joueur consulté, mais ses
--     listes teammates et opponents sont VIDES : le même helper décide le
--     drapeau ET le contenu des listes (une règle, un endroit, évaluée une
--     fois par entrée via LATERAL). Un tiers ne découvre jamais les
--     participants d'un match privé d'autrui, en cohérence avec la RLS de
--     free_match_players.
--   - Matchs retenus : lignes free_match_players où user_id = joueur
--     consulté. Un joueur délié (compte supprimé) n'a plus d'entrée —
--     cohérent avec le recompute des stats, qui ne compte que les lignes
--     liées.
--
-- Rappels :
--   - Pas de récursion : appel fonction → fonction, hors policy. Le
--     propriétaire (DEFINER) lit free_matches / free_match_players hors
--     RLS ; le helper est l'unique vérification — même mécanisme que
--     tournament_is_visible_to_current_user dans results.
--   - Une évaluation du helper (EXISTS sur lookups indexés) par match du
--     joueur — volumétrie de quelques dizaines d'entrées, pas d'enjeu.
--   - Aucune table, aucune statistique, aucun helper modifiés.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bloc 1 : private.get_user_profile — bundle JSON
-- { profile, stats, results, free_matches, free_match_stats }.
--
-- Structure du bundle (les trois premières clés : phase I / viewer_can_open,
-- inchangées) :
--   {
--     "profile": { id, display_name, created_at, updated_at } | null,
--     "stats": { matches_played, wins, losses, points_scored,
--                points_conceded, tournaments_played, tournaments_won,
--                podiums, last_tournament_at } | null,
--     "results": [ { … tournament_id … viewer_can_open, teammates } ],
--     "free_matches": [
--       {
--         match_id, played_on, created_at, score_a, score_b,
--         side,             -- camp du joueur consulté ('A' | 'B')
--         viewer_can_open,  -- l'APPELANT peut-il ouvrir ce match ?
--         teammates: [ { user_id, display_name } ],  -- [] si non ouvrable
--         opponents: [ { user_id, display_name } ]   -- [] si non ouvrable
--       },
--       ...  -- tri par played_on desc, created_at desc, id desc
--     ],
--     "free_match_stats": { matches_played, wins, losses, points_scored,
--                           points_conceded } | null
--   }
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

-- ----------------------------------------------------------------------------
-- Bloc 2 : grants réénoncés (préservés par le create or replace, réaffirmés
-- pour rester explicites et idempotents) + commentaire du wrapper public.
-- ----------------------------------------------------------------------------

revoke all on function private.get_user_profile(uuid) from public;
grant execute on function private.get_user_profile(uuid) to authenticated;

revoke all on function public.get_user_profile(uuid) from public;
revoke all on function public.get_user_profile(uuid) from anon;
grant execute on function public.get_user_profile(uuid) to authenticated;

comment on function public.get_user_profile(uuid) is
  'Returns a JSON bundle for a user profile page: { profile, stats, results, '
  'free_matches, free_match_stats }. Reads aggregated stats from '
  'user_tournament_results / user_stats (materialized on tournament completion) '
  'and user_free_match_stats (materialized on free-match creation / deletion; '
  'null when the player has no free match — no combined total is computed here). '
  'No visibility gate in V1: any authenticated user can read any profile. Each '
  'journal entry (tournament result or free match) carries viewer_can_open, '
  'derived for the CALLER via the shared visibility helpers — the raw visibility '
  'is never exposed. Free-match entries { match_id, played_on, created_at, '
  'score_a, score_b, side, viewer_can_open, teammates, opponents } are ordered by '
  'played_on desc, created_at desc, id desc; side is the consulted player''s camp '
  '(winner iff (side = ''A'') = (score_a > score_b)); teammates (same camp, self '
  'excluded) and opponents are { user_id, display_name } sorted by display_name, '
  'and are BOTH [] when the caller cannot open the match (the participants of a '
  'private match are never disclosed to third parties). '
  'Raises typed error: not_authenticated.';

-- ----------------------------------------------------------------------------
-- Bloc 3 : assertions finales — toute anomalie annule la migration.
-- ----------------------------------------------------------------------------

do $$
declare
  private_is_consistent boolean;
  private_body_is_current boolean;
  wrapper_is_consistent boolean;
  helper_exists boolean;
  authenticated_can_execute_private boolean;
  authenticated_can_execute_wrapper boolean;
  anon_can_execute_wrapper boolean;
begin
  -- search_path = '' est stocké avec l'élément vide CITÉ : search_path="".
  select p.prosecdef and ('search_path=""' = any(p.proconfig))
    into private_is_consistent
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'get_user_profile';

  select p.prosrc like '%''free_matches''%'
         and p.prosrc like '%''free_match_stats''%'
         and p.prosrc like '%private.free_match_is_visible_to_current_user(fm.id)%'
         and p.prosrc like '%private.tournament_is_visible_to_current_user(r.tournament_id)%'
    into private_body_is_current
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'get_user_profile';

  select not p.prosecdef and ('search_path=""' = any(p.proconfig))
    into wrapper_is_consistent
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_user_profile';

  select exists (
    select 1
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and p.proname = 'free_match_is_visible_to_current_user'
  ) into helper_exists;

  select has_function_privilege('authenticated', 'private.get_user_profile(uuid)', 'EXECUTE')
    into authenticated_can_execute_private;
  select has_function_privilege('authenticated', 'public.get_user_profile(uuid)', 'EXECUTE')
    into authenticated_can_execute_wrapper;
  select has_function_privilege('anon', 'public.get_user_profile(uuid)', 'EXECUTE')
    into anon_can_execute_wrapper;

  if private_is_consistent is distinct from true then
    raise exception 'free_matches_in_profile: private.get_user_profile incohérente (security definer / search_path)';
  end if;
  if private_body_is_current is distinct from true then
    raise exception 'free_matches_in_profile: le corps de private.get_user_profile ne porte pas les clés H2.c-1 (ou a perdu le journal des tournois)';
  end if;
  if wrapper_is_consistent is distinct from true then
    raise exception 'free_matches_in_profile: public.get_user_profile incohérente (doit être INVOKER avec search_path)';
  end if;
  if not helper_exists then
    raise exception 'free_matches_in_profile: helper private.free_match_is_visible_to_current_user absent (migration H2.a manquante)';
  end if;
  if not authenticated_can_execute_private or not authenticated_can_execute_wrapper then
    raise exception 'free_matches_in_profile: authenticated doit pouvoir exécuter get_user_profile (privée et wrapper)';
  end if;
  if anon_can_execute_wrapper then
    raise exception 'free_matches_in_profile: anon ne doit pas pouvoir exécuter le wrapper';
  end if;
end;
$$;
