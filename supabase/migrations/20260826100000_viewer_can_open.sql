-- ============================================================================
-- 20260826100000_viewer_can_open
-- Pétankup — Ticket B : chaque entrée du journal de profil indique si
-- l'APPELANT peut ouvrir le tournoi correspondant.
--
-- Contexte : le journal d'un profil expose des tournois que le visiteur ne
-- peut pas forcément ouvrir (décision actée Phase I — pas de gate de
-- visibilité sur le bundle). Faute de le savoir, l'UI restreignait les liens
-- au propre profil du visiteur (H1.d). Ce booléen dérivé permet « lien là
-- où le visiteur peut ouvrir ».
--
-- Décisions actées (Ticket B) :
--   - D1 : ouvrable = tournoi public, OU privé auquel l'appelant a lui-même
--     accès (owner ou membre). Le calcul RÉUTILISE
--     private.tournament_is_visible_to_current_user — la règle de visibilité
--     vit à un seul endroit ; si elle change, ce champ suit.
--   - D2 / anti-fuite : on n'expose QUE le booléen dérivé viewer_can_open,
--     jamais la visibilité brute (public/private) — aucune information
--     nouvelle sur la nature des tournois d'autrui.
--   - Le champ est calculé relativement à l'APPELANT (auth.uid()), pas au
--     propriétaire du profil consulté. auth.uid() traverse le DEFINER (les
--     claims de la requête restent ceux du caller).
--
-- Rappels :
--   - Pas de récursion : appel fonction→fonction ; le précédent documenté
--     (phase_b_1) concernait une policy DE tournaments appelant un helper
--     lisant tournaments — contexte différent.
--   - Une évaluation du helper (EXISTS sur lookups indexés) par entrée du
--     journal — volumétrie de quelques dizaines d'entrées, pas d'enjeu.
--   - Corps repris verbatim de la Phase I, seul le champ viewer_can_open
--     est ajouté. Grants préservés par le create or replace (précédent B.1).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- private.get_user_profile — bundle JSON { profile, stats, results }.
--
-- Structure du bundle :
--   {
--     "profile": { id, display_name, created_at, updated_at } | null,
--     "stats": { matches_played, wins, losses, points_scored,
--                points_conceded, tournaments_played, tournaments_won,
--                podiums, last_tournament_at } | null,
--     "results": [
--       {
--         tournament_id, tournament_name, tournament_date,
--         tournament_completed_at, team_id, team_name,
--         wins, losses, points_scored, points_conceded,
--         final_rank, is_winner, is_podium,
--         viewer_can_open,  -- l'APPELANT peut-il ouvrir ce tournoi ?
--         teammates: [ { user_id, display_name } ]  -- display_name = snapshot
--       },
--       ...  -- tri par tournament_completed_at desc
--     ]
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
    )
  );
end;
$$;

comment on function public.get_user_profile(uuid) is
  'Returns a JSON bundle for a user profile page: { profile, stats, results }. '
  'Reads aggregated stats from user_tournament_results / user_stats (materialized '
  'on tournament completion). No visibility gate in V1: any authenticated user can '
  'read any profile. Each journal entry carries viewer_can_open, derived for the '
  'CALLER via the shared visibility helper (public tournaments, plus private ones '
  'the caller owns or is a member of) — the raw visibility is never exposed. '
  'Raises typed error: not_authenticated.';
