-- ============================================================================
-- 20260608201126_phase_g_1_team_players
-- Pétankup — Phase G.1 : joueurs en table team_players (remplace teams.players[]).
--
--   1. Table public.team_players (user_id nullable, display_name snapshot,
--      composite FK vers teams, partial unique (tournament_id, user_id)).
--   2. RPCs create_team_with_players / update_team_with_players
--      (private DEFINER + wrapper public INVOKER).
--   3. RPC remove_tournament_member (remplace le DELETE direct + un éventuel
--      trigger anti-orphan : gate member_in_team sans bloquer les cascades).
--   4. Retrait de la policy tournament_members_delete_owner (retrait de membre
--      désormais exclusivement via remove_tournament_member).
--   5. Migration des teams.players[] existants → team_players (user_id NULL).
--   6. Drop teams.players.
--
-- Rappels schéma à NE PAS casser :
--   - teams a déjà `unique (id, tournament_id)` (teams_id_tournament_unique) :
--     cible de la composite FK ci-dessous. NE PAS la recréer.
--   - gen_random_uuid est appelé extensions.gen_random_uuid() (search_path '').
--   - Pattern RPC E : fonction privée DEFINER (revoke public + grant authenticated)
--     + wrapper public INVOKER (revoke public/anon + grant authenticated).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Table team_players
-- ----------------------------------------------------------------------------
create table if not exists public.team_players (
  id            uuid primary key default extensions.gen_random_uuid(),
  team_id       uuid not null,
  tournament_id uuid not null,
  user_id       uuid references auth.users(id) on delete set null,
  display_name  text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint team_players_display_name_length
    check (char_length(trim(display_name)) between 1 and 50),

  -- Verrouille l'intégrité tournoi : la team référencée appartient au même
  -- tournoi (même pattern que les composite FK de matches). CASCADE : la
  -- suppression d'une team retire ses joueurs.
  constraint team_players_team_belongs_to_tournament
    foreign key (team_id, tournament_id)
    references public.teams (id, tournament_id)
    on delete cascade
);

-- ----------------------------------------------------------------------------
-- 2. Indexes
-- ----------------------------------------------------------------------------
-- Un user lié ne peut être dans deux équipes du même tournoi (et a fortiori
-- dans deux slots de la même équipe). Partiel : n'affecte pas les joueurs
-- libres (user_id NULL).
create unique index if not exists team_players_one_per_user_per_tournament
  on public.team_players (tournament_id, user_id)
  where user_id is not null;

-- Lookup des joueurs par équipe (affichage).
create index if not exists team_players_team_id_idx
  on public.team_players (team_id);

-- ----------------------------------------------------------------------------
-- 3. Trigger updated_at
-- ----------------------------------------------------------------------------
drop trigger if exists team_players_set_updated_at on public.team_players;
create trigger team_players_set_updated_at
  before update on public.team_players
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. RLS + policies
-- ----------------------------------------------------------------------------
alter table public.team_players enable row level security;

-- SELECT : visible si le tournoi est visible (owner / public / membre).
drop policy if exists "team_players_select_visible" on public.team_players;
create policy "team_players_select_visible"
  on public.team_players for select to authenticated
  using (private.tournament_is_visible_to_current_user(tournament_id));

-- Modify : owner uniquement. Defense-in-depth — le chemin nominal passe par
-- les RPCs (DEFINER). Aucune écriture directe team_players côté client.
drop policy if exists "team_players_modify_owner" on public.team_players;
create policy "team_players_modify_owner"
  on public.team_players for all to authenticated
  using (private.tournament_is_owned_by_current_user(tournament_id))
  with check (private.tournament_is_owned_by_current_user(tournament_id));

-- ----------------------------------------------------------------------------
-- 5. Retrait de la policy DELETE directe sur tournament_members
-- ----------------------------------------------------------------------------
-- Le retrait de membre passe désormais exclusivement par
-- public.remove_tournament_member (bloc 10), qui porte le gate member_in_team.
-- Les cascades (auth.users / tournaments) sont référentielles → non soumises
-- à la RLS → inchangées. Plus aucun chemin RLS-soumis de DELETE direct.
drop policy if exists "tournament_members_delete_owner" on public.tournament_members;

-- ----------------------------------------------------------------------------
-- 6. Migration des données existantes
-- ----------------------------------------------------------------------------
-- Chaque string de teams.players devient un team_player user_id NULL.
-- Filtre les vides (défensif), tronque à 50 (l'ancien schéma ne bornait pas
-- la longueur par élément, la nouvelle CHECK la borne).
insert into public.team_players (team_id, tournament_id, user_id, display_name)
select t.id, t.tournament_id, null, left(trim(player_name), 50)
from public.teams t,
     unnest(t.players) as player_name
where t.players is not null
  and array_length(t.players, 1) > 0
  and trim(player_name) <> '';

-- ----------------------------------------------------------------------------
-- 7. Drop de la colonne teams.players
-- ----------------------------------------------------------------------------
-- Les CHECK teams_players_count / teams_players_no_blank sont supprimées
-- automatiquement avec la colonne. La fonction public.text_array_has_no_blank_values
-- devient orpheline (code mort, retrait reporté au nettoyage final — hors scope).
alter table public.teams drop column players;

-- ----------------------------------------------------------------------------
-- 8. RPC create_team_with_players
-- ----------------------------------------------------------------------------
-- Crée une team + ses joueurs atomiquement. Retourne l'id de la team.
-- p_players : jsonb array de { "user_id": uuid|null, "display_name": text }.
-- Pour user_id non-null : vérifie qu'il est owner OU membre du tournoi, puis
-- snapshot le display_name FRAIS depuis profiles (la valeur display_name du
-- payload n'est utilisée que pour les joueurs libres user_id null).
create or replace function private.create_team_with_players(
  p_tournament_id uuid,
  p_name text,
  p_players jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_team_id uuid;
  v_player jsonb;
  v_user_id uuid;
  v_display_name text;
begin
  v_caller_id := (select auth.uid());
  if v_caller_id is null then
    raise exception 'not_authenticated';
  end if;

  if not exists (
    select 1 from public.tournaments t
     where t.id = p_tournament_id and t.owner_id = v_caller_id
  ) then
    raise exception 'not_owner';
  end if;

  if p_players is null
     or jsonb_typeof(p_players) <> 'array'
     or jsonb_array_length(p_players) < 1
     or jsonb_array_length(p_players) > 3 then
    raise exception 'invalid_player_count';
  end if;

  insert into public.teams (tournament_id, name)
  values (p_tournament_id, p_name)
  returning id into v_team_id;

  for v_player in select value from jsonb_array_elements(p_players)
  loop
    v_user_id := nullif(v_player->>'user_id', '')::uuid;

    if v_user_id is not null then
      -- Le joueur lié doit être owner ou membre du tournoi (anti-fuite de
      -- pseudo + invariant Q12/Q13).
      if not (
        exists (
          select 1 from public.tournaments t
           where t.id = p_tournament_id and t.owner_id = v_user_id
        )
        or exists (
          select 1 from public.tournament_members m
           where m.tournament_id = p_tournament_id and m.user_id = v_user_id
        )
      ) then
        raise exception 'player_not_in_tournament';
      end if;

      select p.display_name into v_display_name
        from public.profiles p
       where p.id = v_user_id;
      if v_display_name is null then
        raise exception 'player_user_not_found';
      end if;
    else
      v_display_name := left(trim(v_player->>'display_name'), 50);
    end if;

    insert into public.team_players (team_id, tournament_id, user_id, display_name)
    values (v_team_id, p_tournament_id, v_user_id, v_display_name);
  end loop;

  return v_team_id;
end;
$$;

revoke all on function private.create_team_with_players(uuid, text, jsonb) from public;
grant execute on function private.create_team_with_players(uuid, text, jsonb) to authenticated;

create or replace function public.create_team_with_players(
  p_tournament_id uuid,
  p_name text,
  p_players jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_team_with_players(p_tournament_id, p_name, p_players);
$$;

revoke all on function public.create_team_with_players(uuid, text, jsonb) from public;
revoke all on function public.create_team_with_players(uuid, text, jsonb) from anon;
grant execute on function public.create_team_with_players(uuid, text, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 9. RPC update_team_with_players
-- ----------------------------------------------------------------------------
-- UPDATE name + remplacement complet des joueurs (DELETE all + re-INSERT),
-- atomique. Retourne l'id de la team. Mêmes gardes que create.
create or replace function private.update_team_with_players(
  p_team_id uuid,
  p_name text,
  p_players jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_tournament_id uuid;
  v_player jsonb;
  v_user_id uuid;
  v_display_name text;
begin
  v_caller_id := (select auth.uid());
  if v_caller_id is null then
    raise exception 'not_authenticated';
  end if;

  select t.tournament_id into v_tournament_id
    from public.teams t
   where t.id = p_team_id;
  if v_tournament_id is null then
    raise exception 'team_not_found';
  end if;

  if not exists (
    select 1 from public.tournaments t
     where t.id = v_tournament_id and t.owner_id = v_caller_id
  ) then
    raise exception 'not_owner';
  end if;

  if p_players is null
     or jsonb_typeof(p_players) <> 'array'
     or jsonb_array_length(p_players) < 1
     or jsonb_array_length(p_players) > 3 then
    raise exception 'invalid_player_count';
  end if;

  update public.teams set name = p_name where id = p_team_id;

  delete from public.team_players where team_id = p_team_id;

  for v_player in select value from jsonb_array_elements(p_players)
  loop
    v_user_id := nullif(v_player->>'user_id', '')::uuid;

    if v_user_id is not null then
      if not (
        exists (
          select 1 from public.tournaments t
           where t.id = v_tournament_id and t.owner_id = v_user_id
        )
        or exists (
          select 1 from public.tournament_members m
           where m.tournament_id = v_tournament_id and m.user_id = v_user_id
        )
      ) then
        raise exception 'player_not_in_tournament';
      end if;

      select p.display_name into v_display_name
        from public.profiles p
       where p.id = v_user_id;
      if v_display_name is null then
        raise exception 'player_user_not_found';
      end if;
    else
      v_display_name := left(trim(v_player->>'display_name'), 50);
    end if;

    insert into public.team_players (team_id, tournament_id, user_id, display_name)
    values (p_team_id, v_tournament_id, v_user_id, v_display_name);
  end loop;

  return p_team_id;
end;
$$;

revoke all on function private.update_team_with_players(uuid, text, jsonb) from public;
grant execute on function private.update_team_with_players(uuid, text, jsonb) to authenticated;

create or replace function public.update_team_with_players(
  p_team_id uuid,
  p_name text,
  p_players jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.update_team_with_players(p_team_id, p_name, p_players);
$$;

revoke all on function public.update_team_with_players(uuid, text, jsonb) from public;
revoke all on function public.update_team_with_players(uuid, text, jsonb) from anon;
grant execute on function public.update_team_with_players(uuid, text, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 10. RPC remove_tournament_member
-- ----------------------------------------------------------------------------
-- Retire un membre (par id de ligne tournament_members). Gates calqués sur
-- B.4 (owner AVANT completed, pour ne pas leaker le status à un non-owner),
-- plus le gate member_in_team. Membre introuvable : no-op idempotent
-- (cohérent avec l'ancien DELETE direct).
create or replace function private.remove_tournament_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_tournament_id uuid;
  v_user_id uuid;
begin
  v_caller_id := (select auth.uid());
  if v_caller_id is null then
    raise exception 'not_authenticated';
  end if;

  select tm.tournament_id, tm.user_id
    into v_tournament_id, v_user_id
    from public.tournament_members tm
   where tm.id = p_member_id;

  -- Idempotent : rien à retirer.
  if v_tournament_id is null then
    return;
  end if;

  if not exists (
    select 1 from public.tournaments t
     where t.id = v_tournament_id and t.owner_id = v_caller_id
  ) then
    raise exception 'not_owner';
  end if;

  if exists (
    select 1 from public.tournaments t
     where t.id = v_tournament_id and t.status = 'completed'
  ) then
    raise exception 'tournament_completed';
  end if;

  -- Bloqué si le membre figure dans une équipe du tournoi (Q11b/Q12) :
  -- il doit d'abord être retiré de l'équipe (via update_team_with_players).
  if exists (
    select 1 from public.team_players tp
     where tp.tournament_id = v_tournament_id and tp.user_id = v_user_id
  ) then
    raise exception 'member_in_team';
  end if;

  delete from public.tournament_members where id = p_member_id;
end;
$$;

revoke all on function private.remove_tournament_member(uuid) from public;
grant execute on function private.remove_tournament_member(uuid) to authenticated;

create or replace function public.remove_tournament_member(p_member_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.remove_tournament_member(p_member_id);
$$;

revoke all on function public.remove_tournament_member(uuid) from public;
revoke all on function public.remove_tournament_member(uuid) from anon;
grant execute on function public.remove_tournament_member(uuid) to authenticated;

comment on function public.remove_tournament_member(uuid) is
  'Removes a tournament member by member row id. Owner-only, blocked on completed tournament and when the member is in a team (member_in_team). Replaces the direct DELETE path (policy removed in this migration).';
