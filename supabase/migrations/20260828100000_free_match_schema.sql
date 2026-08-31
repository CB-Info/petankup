-- ============================================================================
-- 20260828100000_free_match_schema
-- Pétankup — Horizon 2, H2.a : modèle de données du match libre.
--
-- Un match libre est une partie jouée hors tournoi, enregistrée par un de ses
-- participants. Source de vérité : docs/conception_matchs_libres.md (S1-S11,
-- §3, R1-R3) et docs/spec_match_individuel.md.
--
-- Contenu :
--   Bloc 1  : enums free_match_side ('A','B') et free_match_visibility.
--   Bloc 2  : table free_matches (créateur, date de jeu, scores, visibilité).
--   Bloc 3  : table free_match_players (camp, compte facultatif, pseudo figé)
--             — structure jumelle de team_players (S1, convergence future).
--   Bloc 4  : table user_free_match_stats (deny-total, miroir de user_stats).
--   Bloc 5  : helper private.free_match_is_visible_to_current_user.
--   Bloc 6  : RLS + grants.
--   Bloc 7  : private.recompute_user_stats étendue (bloc match libre + garde
--             « compte disparu »).
--   Bloc 8  : RPC create_free_match (privée DEFINER + wrapper public INVOKER).
--   Bloc 9  : triggers de stats (matérialisation / dématérialisation) et S8.
--   Bloc 10 : correction du commentaire catalogue de tournament_is_frozen.
--
-- Décisions actées (conception + arbitrages du 2026-08-28) :
--   - Né terminé, immuable (S2, S3) : aucune colonne de statut, aucun chemin
--     de mise à jour — ni privilège UPDATE, ni policy UPDATE, ni RPC. Ce n'est
--     PAS un gel conditionnel : tournament_is_frozen n'est pas étendu (§3.4).
--   - Règle de score STRICTE : le vainqueur marque exactement 13, le perdant
--     entre 0 et 12 (on joue toujours en 13). Plus stricte que la règle des
--     tournois (« au moins 13 » — défaut connu, à corriger séparément sur
--     données existantes). La non-égalité en découle : pas de CHECK dédié.
--   - Date de jeu (S4, S11) : sert à noter une partie déjà jouée, jamais à en
--     planifier une — bornée à « aujourd'hui » en DATE DE PARIS. Le serveur
--     est en UTC : current_date rejetterait la date locale après minuit.
--   - Camps A et B de 1 à 3 participants, indépendamment l'un de l'autre
--     (S9) ; un compte une seule fois par match ; aucune règle d'homonymie
--     pour les joueurs libres.
--   - Le créateur est un participant à compte (D6) ; seul le créateur
--     supprime (S6). R2 (match orphelin de son créateur) et R3 (enrôlement
--     d'un compte sans son consentement) sont acceptés en V1 (conception §4).
--   - Stats (§3.5) : source distincte user_free_match_stats, écrite par LE
--     writer unique private.recompute_user_stats (étendu, pas dupliqué) ;
--     matérialisation à la création et dématérialisation à la suppression
--     par triggers ; le total combiné n'est jamais stocké ; joueurs libres
--     exclus (pas de compte).
--   - S7 : compte supprimé → user_id NULL (action référentielle), pseudo
--     conservé, stats des autres inchangées. S8 : dernier compte disparu →
--     match supprimé (trigger, verrou par match contre deux suppressions de
--     compte concurrentes).
--
-- Invariants et mécanique à ne PAS casser :
--   - Sémantique des écritures : RPC = erreurs typées P0001 ; écriture
--     directe = 42501 (privilège absent — couche 1) ET aucune policy
--     (couche 2) ; DELETE direct par un non-créateur = 0 ligne (privilège
--     accordé, USING filtre — miroir de tournaments_delete_own).
--   - Récursion RLS : les DEUX policies SELECT appellent le helper DEFINER
--     (une règle, un endroit — §3.3). Aucune récursion : l'erreur 42P17 ne
--     survient que si une policy lit sa propre table SOUS RLS ; un helper
--     DEFINER exécuté par le propriétaire des tables (postgres, aucune table
--     en FORCE ROW LEVEL SECURITY) contourne la RLS — mécanisme sur lequel la
--     Phase I (tables deny-total lues par DEFINER) repose déjà. La copie
--     inline de phase_b_1 est un précédent de prudence, pas une contrainte
--     Postgres.
--   - Garde « compte disparu » de recompute_user_stats (Bloc 7) : corrige un
--     bug latent — un compte supprimé n'a plus de stats, jamais de
--     ré-insertion pendant la cascade de suppression.
--   - Actions référentielles = UPDATE/DELETE ordinaires exécutés avec les
--     droits du propriétaire : elles contournent la RLS et déclenchent les
--     triggers de ligne (S7 et S8 en dépendent).
--   - Aucune table de tournoi, d'équipe ou de match de tournoi modifiée.
--   - Rappels : gen_random_uuid = extensions.gen_random_uuid() ; pattern RPC E
--     (privé DEFINER revoke public + grant authenticated ; wrapper public
--     INVOKER revoke public/anon + grant authenticated) ; search_path = ''
--     sur toute fonction.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bloc 1 : enums (idempotents via DO/EXCEPTION, précédent phase_a).
-- ----------------------------------------------------------------------------

do $$
begin
  create type public.free_match_side as enum ('A', 'B');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.free_match_visibility as enum ('private', 'public');
exception
  when duplicate_object then null;
end $$;

-- ----------------------------------------------------------------------------
-- Bloc 2 : table free_matches.
-- ----------------------------------------------------------------------------

create table if not exists public.free_matches (
  id          uuid primary key default extensions.gen_random_uuid(),
  -- Créateur (D6). NULL après la suppression de son compte : le match
  -- survit (S7) mais plus personne ne peut le supprimer (R2, accepté en V1).
  created_by  uuid references auth.users(id) on delete set null,
  -- Date de jeu (S4), jamais future (S11), en date de Paris.
  played_on   date not null default (timezone('Europe/Paris', now()))::date,
  score_a     integer not null,
  score_b     integer not null,
  visibility  public.free_match_visibility not null default 'private',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Règle de score stricte : le vainqueur marque exactement 13, le perdant
  -- entre 0 et 12. La non-égalité en découle (13 ≠ 0..12).
  constraint free_matches_winner_scores_13
    check (greatest(score_a, score_b) = 13),
  constraint free_matches_loser_between_0_and_12
    check (least(score_a, score_b) between 0 and 12),

  constraint free_matches_played_on_not_in_future
    check (played_on <= (timezone('Europe/Paris', now()))::date)
);

comment on table public.free_matches is
  'Match libre : partie jouée hors tournoi, née terminée et immuable (score par camp, date de jeu, visibilité, créateur). Participants dans free_match_players.';

-- Action référentielle ON DELETE SET NULL à chaque suppression de compte :
-- lookup par créateur (précédent tournaments_owner_id_idx).
create index if not exists free_matches_created_by_idx
  on public.free_matches (created_by)
  where created_by is not null;

-- updated_at : parité avec team_players / tournament_matches. Le seul UPDATE
-- possible est l'action référentielle SET NULL du créateur.
drop trigger if exists free_matches_set_updated_at on public.free_matches;
create trigger free_matches_set_updated_at
  before update on public.free_matches
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Bloc 3 : table free_match_players — jumelle de team_players (S1) :
-- team_id / tournament_id deviennent match_id / side, le reste est identique
-- (compte facultatif, pseudo figé, mêmes bornes).
-- ----------------------------------------------------------------------------

create table if not exists public.free_match_players (
  id            uuid primary key default extensions.gen_random_uuid(),
  match_id      uuid not null references public.free_matches(id) on delete cascade,
  side          public.free_match_side not null,
  -- NULL = joueur libre (sans compte), ou compte supprimé depuis (S7).
  user_id       uuid references auth.users(id) on delete set null,
  -- Pseudo figé à la création, toujours présent : survit à la perte du compte.
  display_name  text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint free_match_players_display_name_length
    check (char_length(trim(display_name)) between 1 and 50)
);

comment on table public.free_match_players is
  'Participants d''un match libre, rattachés à un camp (A ou B) : compte facultatif (user_id) et pseudo figé. Structure jumelle de team_players.';

-- Un compte une seule fois par match, tous camps confondus (§3.2). Partiel :
-- n'affecte pas les joueurs libres (précédent team_players).
create unique index if not exists free_match_players_one_per_user_per_match
  on public.free_match_players (match_id, user_id)
  where user_id is not null;

-- Affichage des participants d'un match.
create index if not exists free_match_players_match_id_idx
  on public.free_match_players (match_id);

-- Recompute des stats et helper de visibilité : lookup par compte.
create index if not exists free_match_players_user_id_idx
  on public.free_match_players (user_id)
  where user_id is not null;

drop trigger if exists free_match_players_set_updated_at on public.free_match_players;
create trigger free_match_players_set_updated_at
  before update on public.free_match_players
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Bloc 4 : table user_free_match_stats — agrégat par joueur de ses matchs
-- libres. Miroir de user_stats (phase_i) sans les compteurs de tournoi ; ses
-- objets dérivés portent son propre nom (user_free_match_stats_*).
-- Une ligne SSI le joueur a au moins un match libre (absence = pas de stats).
-- Deny-total : RLS activée sans policy + revoke ; lue et écrite uniquement en
-- contexte DEFINER (propriétaire).
-- ----------------------------------------------------------------------------

create table if not exists public.user_free_match_stats (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  matches_played   integer not null default 0 check (matches_played >= 0),
  wins             integer not null default 0 check (wins >= 0),
  losses           integer not null default 0 check (losses >= 0),
  points_scored    integer not null default 0 check (points_scored >= 0),
  points_conceded  integer not null default 0 check (points_conceded >= 0),
  last_updated     timestamptz not null default now()
);

comment on table public.user_free_match_stats is
  'Agrégat par joueur de ses matchs libres — source distincte de user_stats, le total combiné se calcule à la lecture. Une ligne SSI le joueur a au moins un match libre. Writer unique : private.recompute_user_stats.';

alter table public.user_free_match_stats enable row level security;

revoke all on table public.user_free_match_stats from public;
revoke all on table public.user_free_match_stats from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Bloc 5 : helper de visibilité — « le match libre <id> est-il visible par
-- le user courant ? » Visible = public OU participant à compte (§3.3).
-- Jumeau de tournament_is_visible_to_current_user (lié, lui, à
-- tournaments/tournament_members — non réemployable tel quel). DEFINER pour
-- lire les deux tables hors RLS ; verrouillé par REVOKE ALL + GRANT ciblé.
-- ----------------------------------------------------------------------------

create or replace function private.free_match_is_visible_to_current_user(p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.free_matches m
     where m.id = p_match_id
       and (
         m.visibility = 'public'
         or exists (
           select 1
             from public.free_match_players p
            where p.match_id = m.id
              and p.user_id = (select auth.uid())
         )
       )
  );
$$;

revoke all on function private.free_match_is_visible_to_current_user(uuid) from public;
grant execute on function private.free_match_is_visible_to_current_user(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Bloc 6 : RLS + grants.
-- SELECT : helper unique sur les deux tables (une règle, un endroit — §3.3,
-- cf. en-tête pour l'absence de récursion). DELETE : créateur seul (S6).
-- Aucune policy INSERT (création via la RPC) ni UPDATE (immuabilité) ; les
-- privilèges correspondants ne sont pas accordés non plus (42501 en direct).
-- ----------------------------------------------------------------------------

alter table public.free_matches enable row level security;
alter table public.free_match_players enable row level security;

drop policy if exists "free_matches_select_visible" on public.free_matches;
create policy "free_matches_select_visible"
  on public.free_matches
  for select
  to authenticated
  using (private.free_match_is_visible_to_current_user(id));

drop policy if exists "free_matches_delete_creator" on public.free_matches;
create policy "free_matches_delete_creator"
  on public.free_matches
  for delete
  to authenticated
  using (created_by = (select auth.uid()));

drop policy if exists "free_match_players_select_visible" on public.free_match_players;
create policy "free_match_players_select_visible"
  on public.free_match_players
  for select
  to authenticated
  using (private.free_match_is_visible_to_current_user(match_id));

revoke all on table public.free_matches from public;
revoke all on table public.free_matches from anon, authenticated;
grant select on table public.free_matches to authenticated;
grant delete on table public.free_matches to authenticated;

revoke all on table public.free_match_players from public;
revoke all on table public.free_match_players from anon, authenticated;
grant select on table public.free_match_players to authenticated;

-- ----------------------------------------------------------------------------
-- Bloc 7 : private.recompute_user_stats — writer unique des deux agrégats.
-- Le bloc tournoi est repris VERBATIM de phase_i (l.221-243) ; s'y ajoutent
-- la garde « compte disparu » en tête et le bloc match libre en queue.
--
-- Garde « compte disparu » (bug latent corrigé) : pendant la suppression d'un
-- compte, la cascade des tournois (première FK vers auth.users dans l'ordre
-- des triggers RI) dématérialise ses tournois terminés et rappelle cette
-- fonction POUR LUI. Ré-insérer alors une ligne de stats viole la FK vers un
-- auth.users déjà supprimé dans la transaction (23503) et annule la
-- suppression du compte. Un compte disparu n'a plus de stats : on purge et on
-- sort. Grants préservés par le replace (aucun grant à authenticated : appelée
-- uniquement en contexte DEFINER).
-- ----------------------------------------------------------------------------

create or replace function private.recompute_user_stats(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- [garde compte disparu — début]
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    delete from public.user_stats where user_id = p_user_id;
    delete from public.user_free_match_stats where user_id = p_user_id;
    return;
  end if;
  -- [garde compte disparu — fin]

  -- Bloc tournoi (verbatim phase_i).
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

  -- Bloc match libre : même motif delete + insert conditionnel. Le camp du
  -- joueur détermine ses points marqués / encaissés ; la victoire découle du
  -- score (le vainqueur est à 13, jamais d'égalité).
  delete from public.user_free_match_stats where user_id = p_user_id;

  insert into public.user_free_match_stats (
    user_id, matches_played, wins, losses,
    points_scored, points_conceded, last_updated
  )
  select
    p_user_id,
    count(*)::int,
    count(*) filter (where participant_points > opponent_points)::int,
    count(*) filter (where participant_points < opponent_points)::int,
    coalesce(sum(participant_points), 0)::int,
    coalesce(sum(opponent_points), 0)::int,
    now()
  from (
    select
      case fmp.side when 'A' then fm.score_a else fm.score_b end as participant_points,
      case fmp.side when 'A' then fm.score_b else fm.score_a end as opponent_points
      from public.free_match_players fmp
      join public.free_matches fm on fm.id = fmp.match_id
     where fmp.user_id = p_user_id
  ) played_matches
  having count(*) > 0;
end;
$$;

-- ----------------------------------------------------------------------------
-- Bloc 8 : RPC create_free_match — crée un match et ses participants
-- atomiquement, retourne l'id du match. Payload p_players : tableau jsonb de
-- { "side": "A"|"B", "user_id": uuid|null, "display_name": text }.
-- Comme create_team_with_players : pour un compte, le pseudo est figé FRAIS
-- depuis profiles (display_name du payload ignoré) ; pour un joueur libre,
-- le nom saisi est conservé.
--
-- DEFINER : contourne la RLS (aucune policy INSERT, par construction). Toutes
-- les garanties sont donc portées ICI, en erreurs typées, dans l'ordre :
--   not_authenticated → invalid_players / invalid_side / invalid_display_name
--   (forme du payload) → not_participant → invalid_side_count →
--   duplicate_player → invalid_score → invalid_played_on → insertions
--   (player_user_not_found si un compte lié n'a pas de profil).
-- Les CHECK des tables restent le filet de sécurité derrière ces gates.
-- ----------------------------------------------------------------------------

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

revoke all on function private.create_free_match(date, public.free_match_visibility, integer, integer, jsonb) from public;
grant execute on function private.create_free_match(date, public.free_match_visibility, integer, integer, jsonb) to authenticated;

create or replace function public.create_free_match(
  p_played_on date,
  p_visibility public.free_match_visibility,
  p_score_a integer,
  p_score_b integer,
  p_players jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_free_match(p_played_on, p_visibility, p_score_a, p_score_b, p_players);
$$;

revoke all on function public.create_free_match(date, public.free_match_visibility, integer, integer, jsonb) from public;
revoke all on function public.create_free_match(date, public.free_match_visibility, integer, integer, jsonb) from anon;
grant execute on function public.create_free_match(date, public.free_match_visibility, integer, integer, jsonb) to authenticated;

comment on function public.create_free_match(date, public.free_match_visibility, integer, integer, jsonb) is
  'Creates a free match with its participants atomically (caller must be a linked participant; sides A/B with 1-3 players each; winner scores exactly 13, loser 0-12; played_on not in the future, Paris date). The match is born completed and immutable: the only later write is its deletion by the creator. Typed errors: not_authenticated, invalid_players, invalid_side, invalid_display_name, not_participant, invalid_side_count, duplicate_player, invalid_score, invalid_played_on, player_user_not_found.';

-- ----------------------------------------------------------------------------
-- Bloc 9 : triggers sur free_match_players. Le match naît terminé : ses
-- stats se matérialisent à l'insertion des participants et se
-- dématérialisent à leur suppression (cascade du DELETE du créateur : la
-- ligne de match est déjà partie quand le trigger tire, le recompute ne la
-- compte plus). Un trigger par ligne suffit : chaque compte n'agrège que ses
-- propres lignes. Les joueurs libres (user_id NULL) ne déclenchent rien.
-- S8 : un compte détaché (action référentielle SET NULL) laisse-t-il le
-- match sans aucun participant à compte ? Alors le match est supprimé.
-- ----------------------------------------------------------------------------

create or replace function private.on_free_match_player_inserted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.recompute_user_stats(new.user_id);
  return null;
end;
$$;

revoke all on function private.on_free_match_player_inserted() from public;

drop trigger if exists free_match_players_materialize_on_insert on public.free_match_players;
create trigger free_match_players_materialize_on_insert
  after insert on public.free_match_players
  for each row
  when (new.user_id is not null)
  execute function private.on_free_match_player_inserted();

create or replace function private.on_free_match_player_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.recompute_user_stats(old.user_id);
  return null;
end;
$$;

revoke all on function private.on_free_match_player_deleted() from public;

drop trigger if exists free_match_players_dematerialize_on_delete on public.free_match_players;
create trigger free_match_players_dematerialize_on_delete
  after delete on public.free_match_players
  for each row
  when (old.user_id is not null)
  execute function private.on_free_match_player_deleted();

create or replace function private.on_free_match_player_unlinked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_linked_participant_remains boolean;
begin
  -- Verrou par match : deux suppressions de compte concurrentes sur le même
  -- match se sérialisent ici ; la seconde relit l'état committé de la
  -- première (sinon chacune verrait l'autre compte encore lié et le match
  -- survivrait sans aucun participant à compte).
  perform 1 from public.free_matches m where m.id = new.match_id for update;

  select exists (
    select 1
      from public.free_match_players p
     where p.match_id = new.match_id
       and p.user_id is not null
  ) into v_linked_participant_remains;

  if not v_linked_participant_remains then
    delete from public.free_matches where id = new.match_id;
  end if;

  -- Recompute inconditionnel de l'ancien compte : no-op si le compte
  -- disparaît (garde de recompute_user_stats — S7, les stats des autres
  -- restent intactes) ; correct pour un futur retrait individuel d'un compte
  -- vivant, qui ne devra rien ajouter ici.
  perform private.recompute_user_stats(old.user_id);
  return null;
end;
$$;

revoke all on function private.on_free_match_player_unlinked() from public;

drop trigger if exists free_match_players_drop_orphan_on_unlink on public.free_match_players;
create trigger free_match_players_drop_orphan_on_unlink
  after update of user_id on public.free_match_players
  for each row
  when (old.user_id is not null and new.user_id is null)
  execute function private.on_free_match_player_unlinked();

-- ----------------------------------------------------------------------------
-- Bloc 10 : commentaire catalogue de tournament_is_frozen. La migration de
-- gel annonçait un « second déclencheur (match libre complété) » — devenu
-- faux : l'immuabilité du match libre est structurelle (aucun chemin
-- d'écriture), pas conditionnelle (conception §3.4). Le corps du prédicat ne
-- change pas.
-- ----------------------------------------------------------------------------

comment on function private.tournament_is_frozen(uuid) is
  'Gel : tournoi parent terminé. Le match libre (Horizon 2) est immuable '
  'structurellement — aucun chemin d''écriture — donc pas de second déclencheur. '
  'Ne JAMAIS appeler depuis une policy de public.tournaments (récursion, '
  'cf. phase_b_1) — le gel de la ligne tournoi passe par trigger.';
