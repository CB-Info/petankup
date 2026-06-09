-- ============================================================================
-- 20260609180000_phase_i_stats_db
-- Pétankup — Phase I : matérialisation des stats joueur (Couches 1 + 2).
--
-- Contenu :
--   Bloc 1 : ajout de tournaments.completed_at (colonne + trigger fill +
--            backfill historique + CHECK d'invariant).
--   Bloc 2 : tables user_tournament_results et user_stats (deny-total RLS).
--   Bloc 3 : fonctions factorisées recompute_user_stats et
--            materialize_tournament_results (avec ranking fidèle au TS).
--   Bloc 4 : triggers AFTER UPDATE OF status (complétion) et BEFORE DELETE
--            (déduplication / recompute) sur tournaments.
--   Bloc 5 : RPC publique get_user_profile (DEFINER privé + wrapper INVOKER).
--   Bloc 6 : backfill des stats pour les tournois déjà complétés.
--
-- Décisions actées (cf. cadrage Phase I) :
--   - Ranking fidèle : départage scalaire + head-to-head intra-groupe +
--     team_id final. Légère divergence possible avec computeRanking TS
--     (app/utils/tournament.ts) uniquement en cas de cycle parfait à 3+
--     équipes (où le TS lui-même n'est pas un ordre total). Documenté comme
--     dette consciente.
--   - Pas de gate de visibilité sur les profils : tout authentifié voit
--     tout. À revisiter en V2 si besoin.
--   - completed_at stockée séparément de updated_at pour ne pas dériver
--     en cas d'update post-complétion (visibilité, etc.).
--
-- Invariants à préserver :
--   - user_stats = agrégat déterministe de user_tournament_results. Un
--     seul writer (private.recompute_user_stats), appelé par les triggers
--     et le backfill pour éviter tout drift.
--   - Les deux nouvelles tables sont en deny-total RLS. Tout accès en
--     lecture passe par get_user_profile (DEFINER). Tout accès en écriture
--     passe par les triggers (DEFINER, contexte propriétaire).
--   - CHECK d'invariant : (status = 'completed') = (completed_at is not null).
--
-- Rappels schéma à NE PAS casser :
--   - gen_random_uuid est appelé extensions.gen_random_uuid() (search_path '').
--   - Pattern RPC E : fonction privée DEFINER (revoke public + grant
--     authenticated) + wrapper public INVOKER (revoke public/anon + grant
--     authenticated).
--   - public.set_updated_at (BEFORE UPDATE) reste en place ; le nouveau
--     trigger BEFORE UPDATE tournaments_set_completed_at se compose avec lui
--     (les deux mutent NEW indépendamment, l'ordre relatif n'a pas d'incidence).
--
-- Dette consciente (révisable, hors scope Phase I) :
--   - Profils tous publics « pour l'instant » (pas de gate de visibilité).
--   - Ranking dupliqué TS (computeRanking) ↔ SQL (bloc ranked ci-dessous).
--   - Cycle parfait à 3+ équipes scalairement à égalité départagé par team_id.
--   - Pas de freeze des matchs sur tournoi completed : un UPDATE de score sur
--     un match d'un tournoi déjà completed ne re-déclenche pas la
--     matérialisation (le trigger ne fire que sur changement de status).
--   - Display names des coéquipiers retournés en snapshot (team_players).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bloc 1.1 : ajout de la colonne completed_at (nullable au début pour
-- permettre le backfill avant d'imposer l'invariant).
-- ----------------------------------------------------------------------------

alter table public.tournaments
  add column if not exists completed_at timestamptz;

-- ----------------------------------------------------------------------------
-- Bloc 1.2 : backfill des tournois déjà complétés. Proxy = updated_at
-- (cf. cadrage : pas de meilleur signal disponible en base). Idempotent
-- via le filtre "completed_at is null".
-- ----------------------------------------------------------------------------

update public.tournaments
   set completed_at = updated_at
 where status = 'completed'
   and completed_at is null;

-- ----------------------------------------------------------------------------
-- Bloc 1.3 : trigger BEFORE UPDATE qui capture now() au passage à
-- 'completed'. INVOKER (défaut) : s'exécute dans le contexte du caller,
-- qui a déjà le droit d'updater tournaments via la policy
-- tournaments_update_own. Pas besoin de DEFINER.
--
-- NB : ce trigger se compose proprement avec public.set_updated_at déjà
-- en place : tous deux sont BEFORE UPDATE, ils mutent NEW indépendamment.
-- L'ordre relatif (alphabétique des noms de trigger) n'a pas d'incidence
-- fonctionnelle.
-- ----------------------------------------------------------------------------

create or replace function private.set_completed_at_on_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    new.completed_at = now();
  end if;
  return new;
end;
$$;

revoke all on function private.set_completed_at_on_completion() from public;

drop trigger if exists tournaments_set_completed_at on public.tournaments;
create trigger tournaments_set_completed_at
  before update on public.tournaments
  for each row execute function private.set_completed_at_on_completion();

-- ----------------------------------------------------------------------------
-- Bloc 1.4 : CHECK d'invariant — completed_at est non-null SSI status est
-- 'completed'. Posée APRÈS le backfill (sinon échoue immédiatement sur
-- les lignes historiques). Idempotent via DO/EXCEPTION.
-- ----------------------------------------------------------------------------

do $$
begin
  alter table public.tournaments
    add constraint tournaments_completed_at_consistency
    check ((status = 'completed') = (completed_at is not null));
exception
  when duplicate_object then null;
end $$;

-- ----------------------------------------------------------------------------
-- Bloc 2.1 : user_tournament_results — une ligne par (user joué, tournoi
-- completed). Source unique de vérité pour la Couche 1 (journal de bord)
-- et le calcul de user_stats.
--
-- Choix de modélisation :
--   - team_id stocké : permet à la RPC de résoudre l'équipe et les
--     coéquipiers EN LIVE sans dénormaliser de noms (snapshot drift).
--   - Pas de win_rate stocké : dérivé en TS (wins / matches_played),
--     évite une colonne calculée à maintenir.
--   - PK (user_id, tournament_id) : un user dans un tournoi donné a
--     exactement une ligne (cohérent avec l'unique partiel
--     team_players_one_per_user_per_tournament).
--   - FKs ON DELETE CASCADE en defense-in-depth ; le BEFORE DELETE
--     trigger sur tournaments (cf. Bloc 4) gère le recompute des
--     user_stats AVANT que la cascade ne supprime les lignes.
-- ----------------------------------------------------------------------------

create table if not exists public.user_tournament_results (
  user_id                 uuid not null references auth.users(id) on delete cascade,
  tournament_id           uuid not null references public.tournaments(id) on delete cascade,
  team_id                 uuid not null references public.teams(id) on delete cascade,
  wins                    integer not null default 0 check (wins >= 0),
  losses                  integer not null default 0 check (losses >= 0),
  points_scored           integer not null default 0 check (points_scored >= 0),
  points_conceded         integer not null default 0 check (points_conceded >= 0),
  final_rank              integer not null check (final_rank >= 1),
  is_winner               boolean not null default false,
  is_podium               boolean not null default false,
  tournament_completed_at timestamptz not null,
  primary key (user_id, tournament_id)
);

-- Index principal : journal d'un user trié par date de complétion desc
-- (pattern de lecture de la Couche 1).
create index if not exists user_tournament_results_user_completed_at_idx
  on public.user_tournament_results (user_id, tournament_completed_at desc);

-- ----------------------------------------------------------------------------
-- Bloc 2.2 : user_stats — agrégat global par user. Une ligne SSI le user
-- a au moins un tournoi completed à son palmarès. Absence = pas
-- d'historique (la RPC retourne stats: null).
-- ----------------------------------------------------------------------------

create table if not exists public.user_stats (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  matches_played     integer not null default 0 check (matches_played >= 0),
  wins               integer not null default 0 check (wins >= 0),
  losses             integer not null default 0 check (losses >= 0),
  points_scored      integer not null default 0 check (points_scored >= 0),
  points_conceded    integer not null default 0 check (points_conceded >= 0),
  tournaments_played integer not null default 0 check (tournaments_played >= 0),
  tournaments_won    integer not null default 0 check (tournaments_won >= 0),
  podiums            integer not null default 0 check (podiums >= 0),
  last_tournament_at timestamptz,
  last_updated       timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Bloc 2.3 : RLS deny-total sur les deux tables.
--
-- Pas de policy = aucune ligne accessible côté caller (avec RLS activée).
-- Couplé aux revoke ci-dessous, double protection :
--   - PostgREST refuse même de tenter la requête (permission denied).
--   - Si quelqu'un grant accidentellement, RLS coupe quand même.
--
-- Les triggers et les fonctions matérialisées écrivent en contexte
-- DEFINER (propriétaire postgres), qui bypass la RLS de ses propres
-- tables. La RPC get_user_profile (DEFINER) lit pour la même raison.
-- ----------------------------------------------------------------------------

alter table public.user_tournament_results enable row level security;
alter table public.user_stats enable row level security;

-- Grants : revoke total pour les rôles applicatifs.
revoke all on table public.user_tournament_results from public;
revoke all on table public.user_tournament_results from anon, authenticated;

revoke all on table public.user_stats from public;
revoke all on table public.user_stats from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Bloc 3.1 : recompute_user_stats(user_id) — recalcule l'agrégat global
-- d'UN user à partir de ses user_tournament_results. Pattern delete +
-- conditional insert : si le user n'a plus d'historique, sa ligne
-- user_stats disparaît (absence = pas de stats).
--
-- DEFINER (propriétaire postgres) pour bypass la RLS sur user_stats
-- et user_tournament_results. Pas de grant authenticated : invoquée
-- uniquement depuis private.materialize_tournament_results et le trigger
-- de suppression (mêmes droits DEFINER). search_path='' obligatoire.
-- ----------------------------------------------------------------------------

create or replace function private.recompute_user_stats(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.user_stats where user_id = p_user_id;

  insert into public.user_stats (
    user_id, matches_played, wins, losses,
    points_scored, points_conceded,
    tournaments_played, tournaments_won, podiums,
    last_tournament_at, last_updated
  )
  select
    p_user_id,
    coalesce(sum(wins + losses), 0)::int,
    coalesce(sum(wins), 0)::int,
    coalesce(sum(losses), 0)::int,
    coalesce(sum(points_scored), 0)::int,
    coalesce(sum(points_conceded), 0)::int,
    count(*)::int,
    count(*) filter (where is_winner)::int,
    count(*) filter (where is_podium)::int,
    max(tournament_completed_at),
    now()
  from public.user_tournament_results
  where user_id = p_user_id
  having count(*) > 0;
end;
$$;

revoke all on function private.recompute_user_stats(uuid) from public;

-- ----------------------------------------------------------------------------
-- Bloc 3.2 : materialize_tournament_results(tournament_id, completed_at)
-- Matérialise (delete + reinsert) les results d'UN tournoi, puis
-- recompute_user_stats pour chaque user impacté. Appelée par :
--   - le trigger de complétion (avec now()) ;
--   - le backfill historique (avec completed_at déjà en base).
--
-- Idempotente : delete + insert garantit la stabilité du résultat
-- quelle que soit l'historique d'appels.
--
-- Ranking : variante B du cadrage.
--   1. scalar_grouped : dense_rank() sur les 3 scalaires (wins,
--      point_diff, points_for) — identifie les groupes d'équipes
--      scalairement à égalité.
--   2. head_to_head : pour chaque équipe, compte ses victoires directes
--      CONTRE les autres équipes du MÊME groupe scalaire — c'est le
--      départage "résultat direct" intra-tie (miroir du head-to-head de
--      tieBreak dans app/utils/tournament.ts).
--   3. ranked : row_number() final avec scalaires + h2h + team_id
--      comme dernier critère déterministe.
--
-- Divergence connue avec computeRanking TS :
--   En cas de cycle parfait à 3+ équipes scalairement à égalité (A bat
--   B, B bat C, C bat A — h2h_wins_in_group == 1 pour les trois),
--   le SQL départage par team_id. Le TS ne définit pas non plus de
--   réponse stable dans ce cas (son comparateur n'est pas un ordre
--   total). Documenté comme dette consciente — fix futur = unifier
--   le ranking en source unique partagée.
--
-- DEFINER pour bypass la RLS sur user_tournament_results et user_stats
-- (via recompute_user_stats appelée en cascade).
-- ----------------------------------------------------------------------------

create or replace function private.materialize_tournament_results(
  p_tournament_id uuid,
  p_completed_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_affected_user uuid;
begin
  -- Wipe propre des lignes existantes pour ce tournoi. Garantit
  -- l'idempotence d'un re-call.
  delete from public.user_tournament_results
   where tournament_id = p_tournament_id;

  -- Matérialisation : agrégats par équipe → ranking fidèle → 1 ligne
  -- par (team_player.user_id non-null) avec les stats de son équipe.
  insert into public.user_tournament_results (
    user_id, tournament_id, team_id,
    wins, losses, points_scored, points_conceded,
    final_rank, is_winner, is_podium,
    tournament_completed_at
  )
  with team_agg as (
    -- Agrégats par équipe : victoires, défaites, points marqués/encaissés.
    -- LEFT JOIN : une équipe sans match completed donne (0, 0, 0, 0).
    select
      tm.id as team_id,
      coalesce(count(*) filter (where mt.winner_id = tm.id), 0)::int as wins,
      coalesce(
        count(*) filter (
          where mt.winner_id is not null and mt.winner_id <> tm.id
        ), 0
      )::int as losses,
      coalesce(sum(case
        when mt.team_a_id = tm.id then mt.score_a
        when mt.team_b_id = tm.id then mt.score_b
        else 0
      end), 0)::int as points_for,
      coalesce(sum(case
        when mt.team_a_id = tm.id then mt.score_b
        when mt.team_b_id = tm.id then mt.score_a
        else 0
      end), 0)::int as points_against
    from public.teams tm
    left join public.matches mt
      on mt.tournament_id = tm.tournament_id
     and mt.status = 'completed'
     and (mt.team_a_id = tm.id or mt.team_b_id = tm.id)
    where tm.tournament_id = p_tournament_id
    group by tm.id
  ),
  scalar_grouped as (
    -- dense_rank sur les 3 scalaires : équipes ayant des scalaires
    -- strictement identiques partagent leur scalar_rank → groupe d'égalité.
    select
      team_id, wins, losses, points_for, points_against,
      (points_for - points_against) as point_diff,
      dense_rank() over (
        order by wins desc, (points_for - points_against) desc, points_for desc
      ) as scalar_rank
    from team_agg
  ),
  head_to_head as (
    -- Pour chaque équipe, compte ses victoires directes contre les
    -- équipes du MÊME groupe scalaire. Une équipe seule dans son groupe
    -- a forcément h2h_wins_in_group = 0 (pas d'autre dans le groupe).
    select
      sg.team_id,
      sg.scalar_rank,
      coalesce(
        count(*) filter (
          where mt.winner_id = sg.team_id
            and opp.scalar_rank = sg.scalar_rank
        ), 0
      )::int as h2h_wins_in_group
    from scalar_grouped sg
    left join public.matches mt
      on mt.tournament_id = p_tournament_id
     and mt.status = 'completed'
     and (mt.team_a_id = sg.team_id or mt.team_b_id = sg.team_id)
    left join scalar_grouped opp
      on opp.team_id = case
        when mt.team_a_id = sg.team_id then mt.team_b_id
        else mt.team_a_id
      end
    group by sg.team_id, sg.scalar_rank
  ),
  ranked as (
    -- row_number final : rang strictement séquentiel (1, 2, 3, ...) sans
    -- partage, garanti déterministe par le team_id en dernier critère.
    -- Aligné avec computeRanking TS qui attribue aussi des rangs séquentiels.
    select
      sg.team_id, sg.wins, sg.losses, sg.points_for, sg.points_against,
      row_number() over (
        order by sg.wins desc,
                 sg.point_diff desc,
                 sg.points_for desc,
                 hh.h2h_wins_in_group desc,
                 sg.team_id
      ) as final_rank
    from scalar_grouped sg
    join head_to_head hh on hh.team_id = sg.team_id
  )
  select
    tp.user_id,
    p_tournament_id,
    r.team_id,
    r.wins,
    r.losses,
    r.points_for,
    r.points_against,
    r.final_rank::int,
    (r.final_rank = 1),
    (r.final_rank <= 3),
    p_completed_at
  from ranked r
  join public.team_players tp
    on tp.team_id = r.team_id
   and tp.user_id is not null;

  -- Recompute des agrégats pour chaque user impacté (lignes qu'on vient
  -- d'insérer). Un user qui sort d'un tournoi (rematérialisation après
  -- édition rétroactive) verra ses agrégats recalculés ; un user qui
  -- arrive idem.
  for v_affected_user in
    select distinct user_id
      from public.user_tournament_results
     where tournament_id = p_tournament_id
  loop
    perform private.recompute_user_stats(v_affected_user);
  end loop;
end;
$$;

revoke all on function private.materialize_tournament_results(uuid, timestamptz) from public;

-- ----------------------------------------------------------------------------
-- Bloc 4.1 : trigger de complétion. AFTER UPDATE OF status pour ne tirer
-- que sur les changements de statut (pas sur n'importe quel update :
-- toggle visibilité, etc.). Condition WHEN explicite : passage VERS
-- 'completed', pas un re-update qui resterait dessus.
--
-- DEFINER pour bypass la RLS sur user_tournament_results et user_stats
-- (écritures via materialize_tournament_results).
-- ----------------------------------------------------------------------------

create or replace function private.on_tournament_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- new.completed_at est déjà rempli par le trigger BEFORE
  -- tournaments_set_completed_at (Bloc 1.3). On le passe à
  -- materialize pour qu'il horodate les lignes user_tournament_results.
  perform private.materialize_tournament_results(new.id, new.completed_at);
  return new;
end;
$$;

revoke all on function private.on_tournament_completed() from public;

drop trigger if exists tournaments_materialize_on_complete on public.tournaments;
create trigger tournaments_materialize_on_complete
  after update of status on public.tournaments
  for each row
  when (new.status = 'completed' and old.status is distinct from 'completed')
  execute function private.on_tournament_completed();

-- ----------------------------------------------------------------------------
-- Bloc 4.2 : trigger de suppression. BEFORE DELETE pour pouvoir lire
-- les user_tournament_results AVANT que la cascade ON DELETE CASCADE
-- ne les emporte. Capture les user_ids impactés, supprime les lignes
-- du tournoi, puis recompute chaque user.
--
-- Ordre critique : on supprime AVANT recompute, sinon recompute lirait
-- encore les lignes en cours de cascade et calculerait des agrégats
-- périmés. Le ON DELETE CASCADE de la FK ne déclenche rien après notre
-- delete (déjà vide).
--
-- WHEN old.status = 'completed' : on ne fait rien sur la suppression
-- d'un brouillon ou d'un tournoi in_progress (aucune ligne stats
-- existante à nettoyer).
-- ----------------------------------------------------------------------------

create or replace function private.on_tournament_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_affected_users uuid[];
  v_user uuid;
begin
  select array_agg(distinct user_id)
    into v_affected_users
    from public.user_tournament_results
   where tournament_id = old.id;

  delete from public.user_tournament_results
   where tournament_id = old.id;

  if v_affected_users is not null then
    foreach v_user in array v_affected_users loop
      perform private.recompute_user_stats(v_user);
    end loop;
  end if;

  return old;
end;
$$;

revoke all on function private.on_tournament_deleted() from public;

drop trigger if exists tournaments_dematerialize_on_delete on public.tournaments;
create trigger tournaments_dematerialize_on_delete
  before delete on public.tournaments
  for each row
  when (old.status = 'completed')
  execute function private.on_tournament_deleted();

-- ----------------------------------------------------------------------------
-- Bloc 5.1 : private.get_user_profile — retourne le bundle JSON pour
-- les Couches 1 + 2 d'un user donné.
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
--         teammates: [ { user_id, display_name } ]  -- display_name = snapshot
--       },
--       ...  -- tri par tournament_completed_at desc
--     ]
--   }
--
-- Cas dégénérés :
--   - p_user_id inexistant : profile null, stats null, results [].
--   - p_user_id existant mais aucun tournoi completed : profile non-null,
--     stats null (pas de ligne user_stats), results [].
--   - Coéquipiers : display_name SNAPSHOT (table team_players), pas le
--     pseudo live. La Phase J/K appliquera la même logique que
--     getPlayerDisplayName (live si user_id lié et profileById hydraté,
--     snapshot sinon) en re-hydratant les pseudos depuis profileById.
--
-- DEFINER pour :
--   1. bypass la RLS deny-total sur user_tournament_results / user_stats ;
--   2. bypass la RLS sur tournaments (le journal expose des tournois que
--      le viewer ne verrait pas autrement — décision actée).
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

revoke all on function private.get_user_profile(uuid) from public;
grant execute on function private.get_user_profile(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Bloc 5.2 : wrapper public exposé via PostgREST. INVOKER : exécute
-- dans le contexte du caller, délègue toute la logique sensible à la
-- fonction privée. Surface PostgREST minimale.
-- ----------------------------------------------------------------------------

create or replace function public.get_user_profile(p_user_id uuid)
returns json
language sql
security invoker
set search_path = ''
as $$
  select private.get_user_profile(p_user_id);
$$;

revoke all on function public.get_user_profile(uuid) from public;
revoke all on function public.get_user_profile(uuid) from anon;
grant execute on function public.get_user_profile(uuid) to authenticated;

comment on function public.get_user_profile(uuid) is
  'Returns a JSON bundle for a user profile page: { profile, stats, results }. '
  'Reads aggregated stats from user_tournament_results / user_stats (materialized '
  'on tournament completion). No visibility gate in V1: any authenticated user can '
  'read any profile. Raises typed error: not_authenticated.';

-- ----------------------------------------------------------------------------
-- Bloc 6 : backfill des stats pour les tournois déjà complétés en base.
-- Réutilise materialize_tournament_results (zéro duplication d'algo).
-- recompute_user_stats est appelé en cascade pour chaque user impacté,
-- donc user_stats est cohérent en sortie de boucle.
-- ----------------------------------------------------------------------------

do $$
declare
  v record;
begin
  for v in
    select id, completed_at
      from public.tournaments
     where status = 'completed'
       and completed_at is not null
  loop
    perform private.materialize_tournament_results(v.id, v.completed_at);
  end loop;
end $$;
