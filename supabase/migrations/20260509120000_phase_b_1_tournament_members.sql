-- ============================================================================
-- 0004_phase_b_1_tournament_members
-- Pétankup — Phase B.1 : tournois privés sur invitation
--   - Table tournament_members (snapshot member_email)
--   - RLS + 3 policies (SELECT owner OR self, INSERT owner, DELETE owner)
--   - Refonte du helper private.tournament_is_visible_to_current_user
--     avec un 3e EXISTS sur tournament_members
--   - Refonte de la policy tournaments_select_visible : ne peut PAS
--     utiliser le helper (récursion), on duplique la logique en dur.
--     À GARDER SYNCHRONISÉ AVEC LE HELPER.
--   - private.invite_tournament_member_by_email : SECURITY DEFINER,
--     normalise l'email, vérifie owner, lookup auth.users, refuse
--     self-invite/doublon, INSERT, retourne la ligne.
--   - public.invite_tournament_member_by_email : wrapper SECURITY
--     INVOKER, exposé via PostgREST, délègue à la fonction privée.
-- Pas de modif sur teams_select_visible / matches_select_visible :
-- elles appellent le helper, dont le code s'enrichit en place.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Table tournament_members
-- ----------------------------------------------------------------------------

create table if not exists public.tournament_members (
  id            uuid primary key default extensions.gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  member_email  text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint tournament_members_member_email_length
    check (char_length(trim(member_email)) between 1 and 320),
  constraint tournament_members_unique_per_tournament
    unique (tournament_id, user_id)
);

-- ----------------------------------------------------------------------------
-- 2. Indexes
-- ----------------------------------------------------------------------------

-- Index principal pour le helper de visibilité et pour le sélecteur
-- "myMemberships" côté client. Filtre user_id en premier (sélectif),
-- jointure tournament_id ensuite.
create index if not exists tournament_members_user_tournament_idx
  on public.tournament_members (user_id, tournament_id);

-- Lookup par tournoi pour la gestion owner-side (modal "Gérer les invités").
create index if not exists tournament_members_tournament_id_idx
  on public.tournament_members (tournament_id);

-- ----------------------------------------------------------------------------
-- 3. Trigger updated_at
-- ----------------------------------------------------------------------------

drop trigger if exists tournament_members_set_updated_at on public.tournament_members;
create trigger tournament_members_set_updated_at
  before update on public.tournament_members
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. RLS + policies sur tournament_members
-- ----------------------------------------------------------------------------

alter table public.tournament_members enable row level security;

-- SELECT : owner du tournoi voit la liste complète, member voit sa
-- propre ligne (cf. D8 du cadrage).
drop policy if exists "tournament_members_select_owner_or_self" on public.tournament_members;
create policy "tournament_members_select_owner_or_self"
  on public.tournament_members
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or private.tournament_is_owned_by_current_user(tournament_id)
  );

-- INSERT : owner only. Garde-fou supplémentaire user_id <> auth.uid()
-- pour empêcher l'auto-invitation même si quelqu'un INSERT en direct
-- sans passer par la RPC.
drop policy if exists "tournament_members_insert_owner" on public.tournament_members;
create policy "tournament_members_insert_owner"
  on public.tournament_members
  for insert
  to authenticated
  with check (
    private.tournament_is_owned_by_current_user(tournament_id)
    and user_id <> (select auth.uid())
  );

-- DELETE : owner only. Pas de self-removal V1 (cf. D9 du cadrage).
drop policy if exists "tournament_members_delete_owner" on public.tournament_members;
create policy "tournament_members_delete_owner"
  on public.tournament_members
  for delete
  to authenticated
  using (
    private.tournament_is_owned_by_current_user(tournament_id)
  );

-- Pas de policy UPDATE : modifications interdites en V1.

-- ----------------------------------------------------------------------------
-- 5. Refonte du helper de visibilité
--    Signature inchangée. Le code s'enrichit d'un 3e EXISTS sur
--    tournament_members. Les grants posés en Phase A.1 restent valides.
-- ----------------------------------------------------------------------------

create or replace function private.tournament_is_visible_to_current_user(t_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.tournaments t
     where t.id = t_id
       and (
         t.owner_id = (select auth.uid())
         or t.visibility = 'public'
         or exists (
           select 1
             from public.tournament_members m
            where m.tournament_id = t.id
              and m.user_id = (select auth.uid())
         )
       )
  );
$$;

-- ----------------------------------------------------------------------------
-- 6. Refonte de tournaments_select_visible
--    Cette policy NE PEUT PAS utiliser le helper ci-dessus (récursion :
--    le helper interroge tournaments). On duplique donc la logique en
--    testant directement les 3 cas. À GARDER SYNCHRONISÉ AVEC LE HELPER
--    en cas d'évolution future.
-- ----------------------------------------------------------------------------

drop policy if exists "tournaments_select_visible" on public.tournaments;
create policy "tournaments_select_visible"
  on public.tournaments
  for select
  to authenticated
  using (
    owner_id = (select auth.uid())
    or visibility = 'public'
    or exists (
      select 1
        from public.tournament_members m
       where m.tournament_id = tournaments.id
         and m.user_id = (select auth.uid())
    )
  );

-- ----------------------------------------------------------------------------
-- 7. Fonction privée — invitation par email
--    SECURITY DEFINER pour bypasser la RLS sur auth.users.
--    Codes d'erreur plats (cf. décisions micro-2 du cadrage) :
--      'invalid_email', 'not_authenticated', 'not_owner',
--      'user_not_found', 'self_invite', 'already_member'.
-- ----------------------------------------------------------------------------

create or replace function private.invite_tournament_member_by_email(
  p_tournament_id uuid,
  p_email text
)
returns public.tournament_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_normalized_email text;
  v_caller_id uuid;
  v_invitee_id uuid;
  v_inserted public.tournament_members;
begin
  -- 1. Normalisation et validation basique de l'email
  v_normalized_email := lower(trim(p_email));
  if char_length(v_normalized_email) = 0 then
    raise exception 'invalid_email';
  end if;

  -- 2. Identité du caller
  v_caller_id := (select auth.uid());
  if v_caller_id is null then
    raise exception 'not_authenticated';
  end if;

  -- 3. Vérification owner du tournoi
  if not exists (
    select 1
      from public.tournaments t
     where t.id = p_tournament_id
       and t.owner_id = v_caller_id
  ) then
    raise exception 'not_owner';
  end if;

  -- 4. Lookup de l'invité dans auth.users (email déjà normalisé
  -- côté Supabase, on doublonne lower() par sécurité)
  select u.id into v_invitee_id
    from auth.users u
   where lower(u.email) = v_normalized_email;
  if v_invitee_id is null then
    raise exception 'user_not_found';
  end if;

  -- 5. Refus auto-invitation
  if v_invitee_id = v_caller_id then
    raise exception 'self_invite';
  end if;

  -- 6. INSERT, en interceptant la contrainte unique
  begin
    insert into public.tournament_members (tournament_id, user_id, member_email)
    values (p_tournament_id, v_invitee_id, v_normalized_email)
    returning * into v_inserted;
  exception
    when unique_violation then
      raise exception 'already_member';
  end;

  return v_inserted;
end;
$$;

revoke all on function private.invite_tournament_member_by_email(uuid, text) from public;
grant execute on function private.invite_tournament_member_by_email(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 8. Wrapper public — exposé via PostgREST
--    SECURITY INVOKER : exécute dans le contexte du caller. Le wrapper
--    ne fait que déléguer, toute la logique sensible est dans la
--    fonction privée. Permet de garder une surface PostgREST minimale
--    sans enterrer la fonction privée derrière un schema non exposé
--    (le schema `private` n'est pas dans db.schema de Supabase).
-- ----------------------------------------------------------------------------

create or replace function public.invite_tournament_member_by_email(
  p_tournament_id uuid,
  p_email text
)
returns public.tournament_members
language sql
security invoker
set search_path = ''
as $$
  select private.invite_tournament_member_by_email(p_tournament_id, p_email);
$$;

revoke all on function public.invite_tournament_member_by_email(uuid, text) from public;
revoke all on function public.invite_tournament_member_by_email(uuid, text) from anon;
grant execute on function public.invite_tournament_member_by_email(uuid, text) to authenticated;
