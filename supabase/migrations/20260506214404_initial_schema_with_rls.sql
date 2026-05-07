-- ============================================================================
-- 0001_initial_schema_with_rls
-- Pétankup V2 — schéma initial, contraintes, indexes, triggers, RLS, policies
-- ============================================================================

-- Filet de sécurité : pgcrypto (gen_random_uuid) — idempotent.
create extension if not exists pgcrypto with schema extensions;

-- ----------------------------------------------------------------------------
-- 1. Functions
-- ----------------------------------------------------------------------------

-- Met à jour updated_at à chaque UPDATE. Source de vérité = horloge serveur.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Vérifie qu'aucun élément d'un text[] n'est vide ou NULL après trim.
-- Retourne false si le tableau est vide, contient un NULL, ou contient
-- une chaîne vide/blanche. IMMUTABLE → utilisable en CHECK.
create or replace function public.text_array_has_no_blank_values(arr text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    bool_and(elem is not null and char_length(trim(elem)) > 0),
    false
  )
  from unnest(arr) as elem;
$$;

-- ----------------------------------------------------------------------------
-- 2. Enums
-- ----------------------------------------------------------------------------

create type public.tournament_status as enum ('draft', 'in_progress', 'completed');
create type public.tournament_format as enum ('round_robin');
create type public.match_status      as enum ('pending', 'completed');

-- ----------------------------------------------------------------------------
-- 3. Tables
-- ----------------------------------------------------------------------------

create table public.tournaments (
  id          uuid primary key default extensions.gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  date        date not null,
  location    text,
  description text,
  format      public.tournament_format not null default 'round_robin',
  status      public.tournament_status not null default 'draft',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint tournaments_name_length
    check (char_length(trim(name)) between 1 and 100),
  constraint tournaments_location_length
    check (location is null or char_length(location) <= 100),
  constraint tournaments_description_length
    check (description is null or char_length(description) <= 500)
);

create table public.teams (
  id            uuid primary key default extensions.gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  name          text not null,
  players       text[] not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint teams_name_length
    check (char_length(trim(name)) between 1 and 50),
  constraint teams_players_count
    check (coalesce(array_length(players, 1), 0) between 1 and 3),
  constraint teams_players_no_blank
    check (public.text_array_has_no_blank_values(players)),

  -- Cible des composite FKs depuis matches (verrouille l'intégrité tournoi).
  constraint teams_id_tournament_unique unique (id, tournament_id)
);

create table public.matches (
  id            uuid primary key default extensions.gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  team_a_id     uuid not null,
  team_b_id     uuid not null,
  score_a       integer,
  score_b       integer,
  winner_id     uuid references public.teams(id) on delete cascade,
  status        public.match_status not null default 'pending',
  round_number  integer not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Composite FKs : team_a et team_b doivent appartenir AU MÊME tournoi
  -- que le match. Verrouillé en DB, indépendamment du client.
  constraint matches_team_a_same_tournament_fkey
    foreign key (team_a_id, tournament_id)
    references public.teams (id, tournament_id)
    on delete cascade,
  constraint matches_team_b_same_tournament_fkey
    foreign key (team_b_id, tournament_id)
    references public.teams (id, tournament_id)
    on delete cascade,

  constraint matches_distinct_teams
    check (team_a_id <> team_b_id),
  constraint matches_round_positive
    check (round_number >= 1),

  constraint matches_pending_no_score
    check (
      status <> 'pending'
      or (score_a is null and score_b is null and winner_id is null)
    ),

  -- Reproduit côté DB la logique de validateScore() + cohérence winner_id.
  -- Le winner_id appartient forcément au même tournoi : il est dans
  -- {team_a_id, team_b_id}, qui sont eux-mêmes verrouillés par les
  -- composite FKs ci-dessus.
  constraint matches_completed_score_valid
    check (
      status <> 'completed'
      or (
        score_a is not null and score_b is not null
        and score_a >= 0 and score_b >= 0
        and greatest(score_a, score_b) >= 13
        and score_a <> score_b
        and winner_id is not null
        and (
          (score_a > score_b and winner_id = team_a_id)
          or (score_b > score_a and winner_id = team_b_id)
        )
      )
    )
);

-- ----------------------------------------------------------------------------
-- 4. Indexes
-- ----------------------------------------------------------------------------

-- Tournaments : liste par owner, triée par date desc (page d'accueil).
create index tournaments_owner_id_idx
  on public.tournaments (owner_id);
create index tournaments_owner_date_idx
  on public.tournaments (owner_id, date desc);

-- Teams : lookup par tournoi + unicité du nom par tournoi.
create index teams_tournament_id_idx
  on public.teams (tournament_id);
create unique index teams_unique_name_per_tournament
  on public.teams (tournament_id, lower(trim(name)));

-- Matches : lookup par tournoi, par round, par équipe.
create index matches_tournament_id_idx
  on public.matches (tournament_id);
create index matches_tournament_round_idx
  on public.matches (tournament_id, round_number);
create index matches_team_a_id_idx
  on public.matches (team_a_id);
create index matches_team_b_id_idx
  on public.matches (team_b_id);
create index matches_winner_id_idx
  on public.matches (winner_id);

-- Une paire d'équipes ne peut apparaître qu'une seule fois par tournoi
-- (ordre indifférent, géré par least/greatest).
create unique index matches_unique_pair_per_tournament
  on public.matches (
    tournament_id,
    least(team_a_id, team_b_id),
    greatest(team_a_id, team_b_id)
  );

-- ----------------------------------------------------------------------------
-- 5. Triggers updated_at
-- ----------------------------------------------------------------------------

create trigger tournaments_set_updated_at
  before update on public.tournaments
  for each row execute function public.set_updated_at();

create trigger teams_set_updated_at
  before update on public.teams
  for each row execute function public.set_updated_at();

create trigger matches_set_updated_at
  before update on public.matches
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 6. RLS — strict owner-only
-- ----------------------------------------------------------------------------

alter table public.tournaments enable row level security;
alter table public.teams       enable row level security;
alter table public.matches     enable row level security;

-- TOURNAMENTS -----------------------------------------------------------------

create policy "tournaments_select_own"
  on public.tournaments for select
  using (owner_id = (select auth.uid()));

create policy "tournaments_insert_own"
  on public.tournaments for insert
  with check (owner_id = (select auth.uid()));

create policy "tournaments_update_own"
  on public.tournaments for update
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "tournaments_delete_own"
  on public.tournaments for delete
  using (owner_id = (select auth.uid()));

-- TEAMS — ownership transitive via tournaments --------------------------------

create policy "teams_select_own"
  on public.teams for select
  using (
    exists (
      select 1 from public.tournaments t
      where t.id = teams.tournament_id
        and t.owner_id = (select auth.uid())
    )
  );

create policy "teams_insert_own"
  on public.teams for insert
  with check (
    exists (
      select 1 from public.tournaments t
      where t.id = teams.tournament_id
        and t.owner_id = (select auth.uid())
    )
  );

create policy "teams_update_own"
  on public.teams for update
  using (
    exists (
      select 1 from public.tournaments t
      where t.id = teams.tournament_id
        and t.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.tournaments t
      where t.id = teams.tournament_id
        and t.owner_id = (select auth.uid())
    )
  );

create policy "teams_delete_own"
  on public.teams for delete
  using (
    exists (
      select 1 from public.tournaments t
      where t.id = teams.tournament_id
        and t.owner_id = (select auth.uid())
    )
  );

-- MATCHES — ownership transitive via tournaments ------------------------------

create policy "matches_select_own"
  on public.matches for select
  using (
    exists (
      select 1 from public.tournaments t
      where t.id = matches.tournament_id
        and t.owner_id = (select auth.uid())
    )
  );

create policy "matches_insert_own"
  on public.matches for insert
  with check (
    exists (
      select 1 from public.tournaments t
      where t.id = matches.tournament_id
        and t.owner_id = (select auth.uid())
    )
  );

create policy "matches_update_own"
  on public.matches for update
  using (
    exists (
      select 1 from public.tournaments t
      where t.id = matches.tournament_id
        and t.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.tournaments t
      where t.id = matches.tournament_id
        and t.owner_id = (select auth.uid())
    )
  );

create policy "matches_delete_own"
  on public.matches for delete
  using (
    exists (
      select 1 from public.tournaments t
      where t.id = matches.tournament_id
        and t.owner_id = (select auth.uid())
    )
  );
