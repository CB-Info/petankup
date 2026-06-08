-- ============================================================================
-- 20260608153728_phase_e_invite_by_display_name
-- Pétankup — Phase E : invitation par pseudo (remplace l'invitation par email).
--
--   1. Drop des deux fonctions d'invitation par email (wrapper public +
--      logique privée), posées en B.1 et refondues en B.4.
--   2. Nouvelle logique private.invite_tournament_member_by_display_name :
--      lookup de l'invité via profiles.display_name (lower(trim(...)),
--      unicité garantie par D.1), mêmes gates que B.4 (owner, completed,
--      self-invite, doublon). member_email renseigné depuis auth.users.email
--      de l'invité (snapshot historique + fallback d'affichage côté UI).
--   3. Wrapper public.invite_tournament_member_by_display_name (SECURITY
--      INVOKER) exposé via PostgREST.
--
-- Codes d'erreur typés remontés (cf. InviteMemberErrorCode côté TS) :
--   not_authenticated, not_owner, tournament_completed,
--   display_name_not_found, self_invite, already_member.
--
-- Schéma tournament_members INCHANGÉ. member_email reste NOT NULL ; il est
-- alimenté ici depuis l'email de l'invité (présent pour tout compte Google /
-- magic-link). Ordre des gates calqué sur B.4 : owner AVANT completed pour
-- ne pas leaker le status à un non-owner.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Drop des fonctions d'invitation par email
-- ----------------------------------------------------------------------------
-- Wrapper public d'abord (il dépend de la fonction privée via son corps SQL),
-- puis la logique privée.
drop function if exists public.invite_tournament_member_by_email(uuid, text);
drop function if exists private.invite_tournament_member_by_email(uuid, text);

-- ----------------------------------------------------------------------------
-- 2. Fonction privée — invitation par pseudo
--    SECURITY DEFINER pour bypasser la RLS sur auth.users et profiles.
-- ----------------------------------------------------------------------------

create or replace function private.invite_tournament_member_by_display_name(
  p_tournament_id uuid,
  p_display_name text
)
returns public.tournament_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_invitee_id uuid;
  v_invitee_email text;
  v_inserted public.tournament_members;
begin
  -- 1. Identité du caller
  v_caller_id := (select auth.uid());
  if v_caller_id is null then
    raise exception 'not_authenticated';
  end if;

  -- 2. Vérification owner du tournoi
  if not exists (
    select 1
      from public.tournaments t
     where t.id = p_tournament_id
       and t.owner_id = v_caller_id
  ) then
    raise exception 'not_owner';
  end if;

  -- 3. Tournoi non terminé. Position APRÈS le check owner pour ne pas
  -- leaker le status à un non-owner (qui doit recevoir 'not_owner').
  if exists (
    select 1
      from public.tournaments t
     where t.id = p_tournament_id
       and t.status = 'completed'
  ) then
    raise exception 'tournament_completed';
  end if;

  -- 4. Lookup de l'invité par pseudo (case- et edge-space-insensitive).
  -- L'unicité posée en D.1 garantit au plus une ligne. member_email est
  -- récupéré depuis auth.users pour le snapshot d'invitation.
  select p.id, u.email
    into v_invitee_id, v_invitee_email
    from public.profiles p
    join auth.users u on u.id = p.id
   where lower(trim(p.display_name)) = lower(trim(p_display_name));
  if v_invitee_id is null then
    raise exception 'display_name_not_found';
  end if;

  -- 5. Refus auto-invitation
  if v_invitee_id = v_caller_id then
    raise exception 'self_invite';
  end if;

  -- 6. INSERT, en interceptant la contrainte unique (tournament_id, user_id)
  begin
    insert into public.tournament_members (tournament_id, user_id, member_email)
    values (p_tournament_id, v_invitee_id, v_invitee_email)
    returning * into v_inserted;
  exception
    when unique_violation then
      raise exception 'already_member';
  end;

  return v_inserted;
end;
$$;

revoke all on function private.invite_tournament_member_by_display_name(uuid, text) from public;
grant execute on function private.invite_tournament_member_by_display_name(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Wrapper public — exposé via PostgREST
--    SECURITY INVOKER : exécute dans le contexte du caller, délègue toute la
--    logique sensible à la fonction privée. Surface PostgREST minimale.
-- ----------------------------------------------------------------------------

create or replace function public.invite_tournament_member_by_display_name(
  p_tournament_id uuid,
  p_display_name text
)
returns public.tournament_members
language sql
security invoker
set search_path = ''
as $$
  select private.invite_tournament_member_by_display_name(p_tournament_id, p_display_name);
$$;

revoke all on function public.invite_tournament_member_by_display_name(uuid, text) from public;
revoke all on function public.invite_tournament_member_by_display_name(uuid, text) from anon;
grant execute on function public.invite_tournament_member_by_display_name(uuid, text) to authenticated;

comment on function public.invite_tournament_member_by_display_name(uuid, text) is
  'Invite a member by display_name (case- and edge-space-insensitive lookup on profiles.display_name). Replaces invite_tournament_member_by_email (Phase E). Raises typed errors: not_authenticated, not_owner, tournament_completed, display_name_not_found, self_invite, already_member.';
