-- ============================================================================
-- 0005_phase_b_4_freeze_members_on_completed
-- Pétankup — Phase B.4 : la liste des invités est figée sur les tournois
-- en status 'completed'. Aucune mutation possible, par aucun chemin —
-- ni RPC d'invitation, ni INSERT direct, ni DELETE direct.
--
-- Trois gates indépendants, cohérents avec l'invariant produit :
--   - Bloc 1 : private.invite_tournament_member_by_email
--              check status <> 'completed' avant le lookup user
--              (lève 'tournament_completed', code typé exposé à l'UI).
--   - Bloc 2 : policy tournament_members_insert_owner
--              ajout d'un guard status <> 'completed' dans WITH CHECK.
--   - Bloc 3 : policy tournament_members_delete_owner
--              ajout d'un guard status <> 'completed' dans USING.
--
-- Asymétrie d'erreur assumée : la RPC remonte un code métier typé ;
-- les chemins INSERT/DELETE direct retombent en permission denied
-- générique (RLS denial). Acceptable car l'UI (canManageMembers, B.3)
-- masque la gestion d'invités sur tournoi terminé — ces chemins ne
-- sont pas atteignables en flow nominal. La refonte de removeMember
-- en RPC typée symétrique est un ticket distinct.
--
-- Inchangé :
--   - Schéma (tables, colonnes, enums, indexes).
--   - Policies SELECT (tournaments, teams, matches, tournament_members).
--   - Helper private.tournament_is_visible_to_current_user — un membre
--     invité avant complétion conserve son accès en lecture.
--   - Wrapper public.invite_tournament_member_by_email — il délègue.
--   - Anti-self-invite via INSERT direct (garde user_id <> auth.uid()
--     conservée dans la policy INSERT).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bloc 1 : refonte de private.invite_tournament_member_by_email
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

  -- 4. Tournoi non terminé. Un tournoi 'completed' est figé : plus
  -- aucune invitation possible. Position APRÈS le check owner pour
  -- ne pas leaker le status à un non-owner (qui doit continuer à
  -- recevoir 'not_owner' inchangé).
  if exists (
    select 1
      from public.tournaments t
     where t.id = p_tournament_id
       and t.status = 'completed'
  ) then
    raise exception 'tournament_completed';
  end if;

  -- 5. Lookup de l'invité dans auth.users (email déjà normalisé
  -- côté Supabase, on doublonne lower() par sécurité)
  select u.id into v_invitee_id
    from auth.users u
   where lower(u.email) = v_normalized_email;
  if v_invitee_id is null then
    raise exception 'user_not_found';
  end if;

  -- 6. Refus auto-invitation
  if v_invitee_id = v_caller_id then
    raise exception 'self_invite';
  end if;

  -- 7. INSERT, en interceptant la contrainte unique
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

-- Signature inchangée → les grants posés en B.1 restent valides.

-- ----------------------------------------------------------------------------
-- Bloc 2 : refonte de la policy INSERT sur tournament_members
-- ----------------------------------------------------------------------------
-- Pattern DROP + CREATE pour rejouabilité (PostgreSQL n'a pas de
-- CREATE OR REPLACE POLICY). Nom de policy conservé.
-- La garde existante user_id <> auth.uid() (anti self-invite via INSERT
-- direct) est préservée — c'est un guard parallèle, pas remplacé.

drop policy if exists "tournament_members_insert_owner" on public.tournament_members;
create policy "tournament_members_insert_owner"
  on public.tournament_members
  for insert
  to authenticated
  with check (
    private.tournament_is_owned_by_current_user(tournament_id)
    and user_id <> (select auth.uid())
    and not exists (
      select 1
        from public.tournaments t
       where t.id = tournament_members.tournament_id
         and t.status = 'completed'
    )
  );

-- ----------------------------------------------------------------------------
-- Bloc 3 : refonte de la policy DELETE sur tournament_members
-- ----------------------------------------------------------------------------
-- Même logique que Bloc 2, côté retrait. La policy SELECT n'est PAS
-- modifiée : un membre invité avant complétion conserve son accès en
-- lecture au tournoi terminé.

drop policy if exists "tournament_members_delete_owner" on public.tournament_members;
create policy "tournament_members_delete_owner"
  on public.tournament_members
  for delete
  to authenticated
  using (
    private.tournament_is_owned_by_current_user(tournament_id)
    and not exists (
      select 1
        from public.tournaments t
       where t.id = tournament_members.tournament_id
         and t.status = 'completed'
    )
  );
