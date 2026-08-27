-- ============================================================================
-- Renommage : public.matches → public.tournament_matches
--
-- Pourquoi : la table est 100 % tournoi (tournament_id NOT NULL, FKs
-- composites vers teams, round_number). L'arrivée du match libre
-- (free_matches, Horizon 2) rendrait le nom « matches » ambigu. On aligne
-- le nom sur son domaine réel AVANT de créer la seconde famille.
--
-- Renommage STRICT : aucune contrainte, policy, fonction ou index n'est
-- modifié au-delà de son nom. Aucune donnée touchée. Pas de vue de
-- compatibilité : l'application est mise à jour dans le même lot.
--
-- Ce que Postgres suit tout seul (lié par OID) : expressions des policies,
-- des CHECK et des index, ACL de la table, flag RLS, rattachement du
-- trigger. Ce qu'il ne suit PAS : les NOMS des objets dérivés (contraintes,
-- index, trigger, policies) et le CORPS des fonctions (texte dans
-- pg_proc.prosrc, résolu à l'appel).
--
-- Idempotent : chaque bloc lit le catalogue avant d'agir (ancien nom
-- présent ET nouveau nom absent). Rejouable sans erreur.
--
--   Bloc 1 : la table
--   Bloc 2 : les 9 contraintes (PK, 4 FK, 4 CHECK)
--   Bloc 3 : les 6 index nommés (l'index de PK suit sa contrainte, Bloc 2)
--   Bloc 4 : le trigger updated_at
--   Bloc 5 : les 4 policies
--   Bloc 6 : private.materialize_tournament_results — seule fonction dont
--            le corps nomme la table (corps verbatim, deux lignes changées)
--   Bloc 7 : assertions finales — tout résidu fait échouer, donc annuler,
--            la migration
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bloc 1 : la table
-- ----------------------------------------------------------------------------

do $$
declare
  old_table_exists constant boolean := to_regclass('public.matches') is not null;
  new_table_exists constant boolean := to_regclass('public.tournament_matches') is not null;
begin
  if old_table_exists and new_table_exists then
    raise exception 'rename_matches: public.matches et public.tournament_matches coexistent — état inattendu, intervention manuelle requise';
  end if;

  if not old_table_exists and not new_table_exists then
    raise exception 'rename_matches: ni public.matches ni public.tournament_matches n''existe';
  end if;

  if old_table_exists then
    alter table public.matches rename to tournament_matches;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- Bloc 2 : les contraintes. Les trois premières portent des noms générés
-- par Postgres (PK et REFERENCES inline de la migration initiale), les six
-- autres ont été nommées explicitement. Renommer la PK renomme aussi son
-- index (pas de ligne dédiée au Bloc 3).
-- ----------------------------------------------------------------------------

do $$
declare
  table_oid constant oid := 'public.tournament_matches'::regclass;
  rename_pair text[];
  old_name text;
  new_name text;
begin
  foreach rename_pair slice 1 in array array[
    ['matches_pkey',                       'tournament_matches_pkey'],
    ['matches_tournament_id_fkey',         'tournament_matches_tournament_id_fkey'],
    ['matches_winner_id_fkey',             'tournament_matches_winner_id_fkey'],
    ['matches_team_a_same_tournament_fkey', 'tournament_matches_team_a_same_tournament_fkey'],
    ['matches_team_b_same_tournament_fkey', 'tournament_matches_team_b_same_tournament_fkey'],
    ['matches_distinct_teams',             'tournament_matches_distinct_teams'],
    ['matches_round_positive',             'tournament_matches_round_positive'],
    ['matches_pending_no_score',           'tournament_matches_pending_no_score'],
    ['matches_completed_score_valid',      'tournament_matches_completed_score_valid']
  ]
  loop
    old_name := rename_pair[1];
    new_name := rename_pair[2];

    if exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid = table_oid and conname = old_name
       )
       and not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid = table_oid and conname = new_name
       )
    then
      execute format(
        'alter table public.tournament_matches rename constraint %I to %I',
        old_name, new_name
      );
    end if;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- Bloc 3 : les index nommés explicitement dans la migration initiale.
-- ----------------------------------------------------------------------------

do $$
declare
  table_oid constant oid := 'public.tournament_matches'::regclass;
  rename_pair text[];
  old_name text;
  new_name text;
begin
  foreach rename_pair slice 1 in array array[
    ['matches_tournament_id_idx',          'tournament_matches_tournament_id_idx'],
    ['matches_tournament_round_idx',       'tournament_matches_tournament_round_idx'],
    ['matches_team_a_id_idx',              'tournament_matches_team_a_id_idx'],
    ['matches_team_b_id_idx',              'tournament_matches_team_b_id_idx'],
    ['matches_winner_id_idx',              'tournament_matches_winner_id_idx'],
    ['matches_unique_pair_per_tournament', 'tournament_matches_unique_pair_per_tournament']
  ]
  loop
    old_name := rename_pair[1];
    new_name := rename_pair[2];

    if exists (
         select 1
           from pg_catalog.pg_index index_entry
           join pg_catalog.pg_class index_class on index_class.oid = index_entry.indexrelid
          where index_entry.indrelid = table_oid and index_class.relname = old_name
       )
       and not exists (
         select 1
           from pg_catalog.pg_index index_entry
           join pg_catalog.pg_class index_class on index_class.oid = index_entry.indexrelid
          where index_entry.indrelid = table_oid and index_class.relname = new_name
       )
    then
      execute format('alter index public.%I rename to %I', old_name, new_name);
    end if;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- Bloc 4 : le trigger updated_at (seul trigger de la table).
-- ----------------------------------------------------------------------------

do $$
declare
  table_oid constant oid := 'public.tournament_matches'::regclass;
begin
  if exists (
       select 1 from pg_catalog.pg_trigger
        where tgrelid = table_oid and not tgisinternal
          and tgname = 'matches_set_updated_at'
     )
     and not exists (
       select 1 from pg_catalog.pg_trigger
        where tgrelid = table_oid and not tgisinternal
          and tgname = 'tournament_matches_set_updated_at'
     )
  then
    alter trigger matches_set_updated_at on public.tournament_matches
      rename to tournament_matches_set_updated_at;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- Bloc 5 : les policies. Leurs expressions (USING / WITH CHECK) sont
-- stockées sous forme d'arbres liés à l'OID de la table : elles restent
-- valides telles quelles, seul le nom change. Aucune re-création.
-- ----------------------------------------------------------------------------

do $$
declare
  table_oid constant oid := 'public.tournament_matches'::regclass;
  rename_pair text[];
  old_name text;
  new_name text;
begin
  foreach rename_pair slice 1 in array array[
    ['matches_select_visible', 'tournament_matches_select_visible'],
    ['matches_insert_own',     'tournament_matches_insert_own'],
    ['matches_update_own',     'tournament_matches_update_own'],
    ['matches_delete_own',     'tournament_matches_delete_own']
  ]
  loop
    old_name := rename_pair[1];
    new_name := rename_pair[2];

    if exists (
         select 1 from pg_catalog.pg_policy
          where polrelid = table_oid and polname = old_name
       )
       and not exists (
         select 1 from pg_catalog.pg_policy
          where polrelid = table_oid and polname = new_name
       )
    then
      execute format(
        'alter policy %I on public.tournament_matches rename to %I',
        old_name, new_name
      );
    end if;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- Bloc 6 : private.materialize_tournament_results. Son corps (texte, résolu
-- à l'appel) nomme la table deux fois ; sans ce replace, la prochaine
-- complétion de tournoi échouerait (42P01) et resterait bloquée.
-- Corps repris VERBATIM de phase_i (20260609180000, l.282-417) : seules les
-- deux lignes « left join public.matches mt » changent. En-tête identique
-- (security definer, search_path=''). Grants préservés par le replace
-- (précédent tournament_freeze) : rien à ré-émettre.
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
    left join public.tournament_matches mt
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
    left join public.tournament_matches mt
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

-- ----------------------------------------------------------------------------
-- Bloc 7 : assertions finales. Un oubli dans les listes ci-dessus serait un
-- « skip » silencieux : on vérifie donc l'état réel du catalogue, scopé à
-- la table renommée. Toute anomalie lève une exception, ce qui annule la
-- migration entière (transaction du db push).
-- ----------------------------------------------------------------------------

do $$
declare
  table_oid constant oid := 'public.tournament_matches'::regclass;
  residual_names text;
  renamed_constraint_count int;
  renamed_index_count int;
  renamed_trigger_count int;
  renamed_policy_count int;
  function_is_consistent boolean;
begin
  if to_regclass('public.matches') is not null then
    raise exception 'rename_matches: public.matches existe encore';
  end if;

  -- Aucun objet de la table ne doit garder le préfixe « matches_ ».
  select string_agg(object_name, ', ' order by object_name)
    into residual_names
    from (
      select conname as object_name
        from pg_catalog.pg_constraint
       where conrelid = table_oid and conname like 'matches\_%'
      union all
      select index_class.relname
        from pg_catalog.pg_index index_entry
        join pg_catalog.pg_class index_class on index_class.oid = index_entry.indexrelid
       where index_entry.indrelid = table_oid and index_class.relname like 'matches\_%'
      union all
      select tgname
        from pg_catalog.pg_trigger
       where tgrelid = table_oid and not tgisinternal and tgname like 'matches\_%'
      union all
      select polname
        from pg_catalog.pg_policy
       where polrelid = table_oid and polname like 'matches\_%'
    ) residual;

  if residual_names is not null then
    raise exception 'rename_matches: objets encore nommés matches_* sur tournament_matches : %',
      residual_names;
  end if;

  -- Et les comptes attendus sous le nouveau préfixe : 9 contraintes,
  -- 7 index (les 6 nommés + celui de la PK), 1 trigger, 4 policies.
  select count(*) into renamed_constraint_count
    from pg_catalog.pg_constraint
   where conrelid = table_oid and conname like 'tournament\_matches\_%';
  select count(*) into renamed_index_count
    from pg_catalog.pg_index index_entry
    join pg_catalog.pg_class index_class on index_class.oid = index_entry.indexrelid
   where index_entry.indrelid = table_oid and index_class.relname like 'tournament\_matches\_%';
  select count(*) into renamed_trigger_count
    from pg_catalog.pg_trigger
   where tgrelid = table_oid and not tgisinternal and tgname like 'tournament\_matches\_%';
  select count(*) into renamed_policy_count
    from pg_catalog.pg_policy
   where polrelid = table_oid and polname like 'tournament\_matches\_%';

  if (renamed_constraint_count, renamed_index_count, renamed_trigger_count, renamed_policy_count)
     is distinct from (9, 7, 1, 4)
  then
    raise exception 'rename_matches: comptes inattendus — contraintes %, index %, triggers %, policies % (attendu 9, 7, 1, 4)',
      renamed_constraint_count, renamed_index_count, renamed_trigger_count, renamed_policy_count;
  end if;

  -- La fonction remplacée : corps sur la nouvelle table, et attributs
  -- d'en-tête conservés (un replace prend security definer et search_path
  -- de la NOUVELLE définition — un oubli la ferait tourner en invoker).
  select p.prosecdef
         and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%'
         and p.prosrc not like '%public.matches%'
         and p.prosrc like '%public.tournament_matches%'
    into function_is_consistent
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'materialize_tournament_results';

  if function_is_consistent is distinct from true then
    raise exception 'rename_matches: private.materialize_tournament_results incohérente (corps, security definer ou search_path)';
  end if;
end;
$$;
