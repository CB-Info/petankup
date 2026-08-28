-- ============================================================================
-- 20260828150000_free_match_balanced_sides
-- Pétankup — match libre : camps équilibrés (révision de S9).
--
-- Revirement produit du 2026-08-28 : un match libre se joue en tête-à-tête,
-- doublette ou triplette — les deux camps comptent le même nombre de
-- joueurs. H2.a (20260828100000) autorisait 2 contre 3 (S9 initiale) : son
-- en-tête (« indépendamment l'un de l'autre (S9) ») et le commentaire de sa
-- gate d'effectifs sont périmés sur ce point, cette migration fait foi.
--
-- Périmètre : SEULE la fonction de création change — corps repris VERBATIM
-- de H2.a (l.385-511), un seul bloc ajouté juste après la gate d'effectifs.
-- La règle « 1 à 3 par camp » est conservée telle quelle et se vérifie
-- d'abord : un 4 contre 4 échoue pour effectif (invalid_side_count), pas
-- pour déséquilibre (unbalanced_sides). Code d'erreur distinct pour que
-- l'interface distingue « un camp doit compter 1 à 3 joueurs » de « les deux
-- camps doivent avoir le même nombre de joueurs ».
--
-- Tables, policies, triggers, statistiques : intacts. Wrapper public
-- inchangé (son commentaire catalogue est ré-émis avec le nouveau code).
-- Grants préservés par le replace (précédent tournament_freeze / rename).
-- Idempotent.
-- ============================================================================

create or replace function private.create_free_match(
  p_played_on date,
  p_visibility public.free_match_visibility,
  p_score_a integer,
  p_score_b integer,
  p_players jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_match_id uuid;
  v_player jsonb;
  v_side text;
  v_user_id uuid;
  v_display_name text;
  v_side_a_count integer := 0;
  v_side_b_count integer := 0;
  v_linked_account_ids uuid[] := '{}';
  v_distinct_linked_account_count integer;
  v_today_in_paris date := (timezone('Europe/Paris', now()))::date;
begin
  v_caller_id := (select auth.uid());
  if v_caller_id is null then
    raise exception 'not_authenticated';
  end if;

  if p_players is null
     or jsonb_typeof(p_players) <> 'array'
     or jsonb_array_length(p_players) < 1 then
    raise exception 'invalid_players';
  end if;

  -- Première passe : forme du payload (camp, nom des joueurs libres), comptes
  -- par camp, comptes liés.
  for v_player in select value from jsonb_array_elements(p_players)
  loop
    v_side := v_player->>'side';
    if v_side is null or v_side not in ('A', 'B') then
      raise exception 'invalid_side';
    end if;

    if v_side = 'A' then
      v_side_a_count := v_side_a_count + 1;
    else
      v_side_b_count := v_side_b_count + 1;
    end if;

    v_user_id := nullif(v_player->>'user_id', '')::uuid;
    if v_user_id is not null then
      v_linked_account_ids := array_append(v_linked_account_ids, v_user_id);
    elsif coalesce(trim(v_player->>'display_name'), '') = '' then
      raise exception 'invalid_display_name';
    end if;
  end loop;

  -- Le créateur doit être un participant à compte (D6).
  if not (v_caller_id = any(v_linked_account_ids)) then
    raise exception 'not_participant';
  end if;

  -- 1 à 3 participants par camp, indépendamment (S9).
  if v_side_a_count not between 1 and 3
     or v_side_b_count not between 1 and 3 then
    raise exception 'invalid_side_count';
  end if;

  -- Camps équilibrés (S9 révisée le 2026-08-28) : un match libre se joue en
  -- tête-à-tête, doublette ou triplette — même effectif des deux côtés. La
  -- règle 1..3 ci-dessus se vérifie d'abord : un 4c4 échoue pour effectif.
  if v_side_a_count <> v_side_b_count then
    raise exception 'unbalanced_sides';
  end if;

  -- Un compte une seule fois par match, tous camps confondus (§3.2).
  select count(distinct linked_account_id)
    into v_distinct_linked_account_count
    from unnest(v_linked_account_ids) as linked_account_id;
  if v_distinct_linked_account_count <> array_length(v_linked_account_ids, 1) then
    raise exception 'duplicate_player';
  end if;

  -- Règle de score stricte : vainqueur à 13 exactement, perdant entre 0 et 12.
  if p_score_a is null or p_score_b is null
     or greatest(p_score_a, p_score_b) <> 13
     or least(p_score_a, p_score_b) not between 0 and 12 then
    raise exception 'invalid_score';
  end if;

  -- Date de jeu jamais future (S11), en date de Paris.
  if p_played_on > v_today_in_paris then
    raise exception 'invalid_played_on';
  end if;

  insert into public.free_matches (created_by, played_on, score_a, score_b, visibility)
  values (
    v_caller_id,
    coalesce(p_played_on, v_today_in_paris),
    p_score_a,
    p_score_b,
    coalesce(p_visibility, 'private')
  )
  returning id into v_match_id;

  for v_player in select value from jsonb_array_elements(p_players)
  loop
    v_user_id := nullif(v_player->>'user_id', '')::uuid;

    if v_user_id is not null then
      select p.display_name into v_display_name
        from public.profiles p
       where p.id = v_user_id;
      if v_display_name is null then
        raise exception 'player_user_not_found';
      end if;
    else
      v_display_name := left(trim(v_player->>'display_name'), 50);
    end if;

    insert into public.free_match_players (match_id, side, user_id, display_name)
    values (
      v_match_id,
      (v_player->>'side')::public.free_match_side,
      v_user_id,
      v_display_name
    );
  end loop;

  return v_match_id;
end;
$$;

comment on function public.create_free_match(date, public.free_match_visibility, integer, integer, jsonb) is
  'Creates a free match with its participants atomically (caller must be a linked participant; sides A/B with the same number of players, 1-3 each — singles, doubles or triples; winner scores exactly 13, loser 0-12; played_on not in the future, Paris date). The match is born completed and immutable: the only later write is its deletion by the creator. Typed errors: not_authenticated, invalid_players, invalid_side, invalid_display_name, not_participant, invalid_side_count, unbalanced_sides, duplicate_player, invalid_score, invalid_played_on, player_user_not_found.';

-- ----------------------------------------------------------------------------
-- Assertion finale : la fonction en place porte bien la nouvelle gate et
-- reste SECURITY DEFINER (un replace prend ses attributs de la nouvelle
-- définition). Toute anomalie annule la migration.
-- ----------------------------------------------------------------------------

do $$
declare
  function_is_consistent boolean;
begin
  select p.prosecdef
         and p.prosrc like '%unbalanced_sides%'
         and p.prosrc like '%invalid_side_count%'
    into function_is_consistent
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'create_free_match';

  if function_is_consistent is distinct from true then
    raise exception 'free_match_balanced_sides: private.create_free_match incohérente (gate absente ou security definer perdu)';
  end if;
end;
$$;
