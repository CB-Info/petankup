-- ============================================================================
-- 20260901180000_friendship_schema
-- Pétankup — la relation d'amitié (ticket A1).
--
-- Source de vérité : docs/spec_amitie_confidentialite.md (A1-A8) et
-- docs/conception_amitie_confidentialite.md (F1-F8, §4.1). Ce ticket ne
-- touche PAS à la confidentialité, à la fonction de profil ni à la règle
-- d'accès actuelle (ticket A2) : aucune table existante, aucune policy,
-- aucune fonction existante modifiée.
--
-- Contenu :
--   Bloc 1 : enum friendship_status ('pending', 'accepted') — F3.
--   Bloc 2 : table friendships (duo ordonné, demandeur, statut) + trigger
--            updated_at + index.
--   Bloc 3 : deny-total — RLS sans policy + revokes (précédent Phase I).
--   Bloc 4 : les 6 RPC (pattern E : privée DEFINER + wrapper public
--            INVOKER) — request / accept / refuse / cancel / remove +
--            get_friendships (lecture en trois listes).
--   Bloc 5 : assertions finales.
--
-- Décisions actées (docs + arbitrages du ticket) :
--   - F1 : une ligne par duo, les deux ids rangés en ordre déterministe
--     (user_low_id < user_high_id, comparaison d'uuid). La contrainte
--     friendships_ordered_pair REJETTE toute insertion hors ordre :
--     l'unicité du duo découle de la structure (friendships_unique_pair),
--     pas du code. Aucun précédent de CHECK (a < b) dans le dépôt — le plus
--     proche, l'index unique least/greatest de tournament_matches,
--     normalise à la vérification sans imposer l'ordre au stockage ; ici
--     l'ordre stocké EST la règle (assumé).
--   - L'inégalité STRICTE donne F6 gratuitement : user_low_id = user_high_id
--     est impossible, l'auto-amitié aussi.
--   - F2 : requester_id porte « qui a demandé » (l'ordre imposé perd cette
--     information) ; friendships_requester_in_pair le cantonne au duo. Pas
--     de FK dédiée : toujours égal à l'une des deux colonnes déjà FK
--     CASCADE, il ne peut jamais pendre.
--   - F4/A5 : refus et annulation SUPPRIMENT la ligne — aucun état
--     « refusée », redemander marche immédiatement.
--   - F5/A7 : demandes croisées — la seconde retombe sur la ligne existante
--     (même duo ordonné) et ACCEPTE. Effet naturel de F1 dans
--     request_friendship, pas un cas particulier.
--   - F6 dans les actions par user_id : la paire est calculée depuis
--     auth.uid() ; se viser soi-même (ou NULL — least/greatest ignorent
--     NULL) donne least = greatest, donc jamais de ligne (ordered_pair)
--     → request_not_found / no-op, sans garde dédiée.
--   - F7 : suppression de compte → FK ON DELETE CASCADE sur les DEUX
--     colonnes du duo (la ligne « appartient » aux deux comptes).
--   - F8/A8 : l'annulation d'une demande envoyée est une action DÉDIÉE
--     (cancel_friendship_request), pas une extension du retrait — les
--     droits diffèrent : le retrait est ouvert aux deux parties d'une
--     amitié acceptée (et idempotent), l'annulation au seul demandeur
--     d'une demande en attente (refus typés not_requester /
--     request_not_found, miroir de refuse).
--   - A2 : la demande passe par le PSEUDO EXACT — request_friendship
--     consomme private.find_account_by_display_name (règle de recherche
--     partagée, même normalisation que l'unicité D.1). Les quatre autres
--     actions prennent l'user_id de l'autre, fourni par les listes.
--   - Deny-total sur friendships : TOUTE lecture passe par get_friendships,
--     toute écriture par les 5 RPC d'action — une seule voie par opération.
--     Le client ne doit JAMAIS voir user_low_id / user_high_id ni le
--     requester brut : une policy SELECT « ma ligne » les exposerait via
--     PostgREST. Précédent : user_stats (Phase I).
--   - Les RPC sont DEFINER (contournent la RLS — ici deny-total) : TOUTES
--     les garanties de conception §4.1 sont répétées dans les corps, en
--     erreurs typées, gardes ordonnées not_authenticated d'abord.
--   - get_friendships lit profiles hors RLS (DEFINER) : elle n'expose que
--     {user_id, display_name} de l'AUTRE personne de chaque relation du
--     caller — pas plus que ce que find_account_by_display_name révèle
--     déjà.
--
-- Codes d'erreur (P0001, message = code brut, précédent phase E) :
--   not_authenticated, display_name_not_found (existants) ; self_request,
--   already_requested, already_friends, request_not_found, not_addressee,
--   not_requester (nouveaux, même style que self_invite / already_member).
--
-- Course concurrente assumée (documentée, non traitée) : deux demandes
-- croisées simultanées peuvent toutes deux passer le SELECT ... FOR UPDATE
-- sans trouver de ligne (rien à verrouiller) ; la seconde insertion tombe
-- sur friendships_unique_pair et est re-signalée already_requested au lieu
-- d'accepter (F5). Auto-réparant : au rappel, la ligne existe et F5 joue.
-- Précédent du mapping unique_violation → code métier : already_member.
--
-- Idempotente (create or replace, if not exists, DO/EXCEPTION, drop trigger
-- if exists, grants rejouables) ; search_path = '' partout ; aucun fichier
-- applicatif, aucune table existante touchée ; gen:types différé au ticket
-- d'interface (précédent : commits chore(types) séparés).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bloc 1 : enum (idempotent via DO/EXCEPTION, précédent phase_a).
-- ----------------------------------------------------------------------------

do $$
begin
  create type public.friendship_status as enum ('pending', 'accepted');
exception
  when duplicate_object then null;
end $$;

-- ----------------------------------------------------------------------------
-- Bloc 2 : table friendships.
-- ----------------------------------------------------------------------------

create table if not exists public.friendships (
  id            uuid primary key default extensions.gen_random_uuid(),
  -- Le duo, en ordre déterministe (F1) : le plus petit uuid à gauche.
  user_low_id   uuid not null references auth.users(id) on delete cascade,
  user_high_id  uuid not null references auth.users(id) on delete cascade,
  -- Qui a demandé (F2) — l'ordre imposé perd cette information. Pas de FK :
  -- toujours l'une des deux colonnes du duo (CHECK ci-dessous), déjà FK
  -- CASCADE ; il ne peut jamais pendre.
  requester_id  uuid not null,
  status        public.friendship_status not null default 'pending',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- F1 : insertion hors ordre impossible. L'inégalité STRICTE rend aussi
  -- l'auto-amitié impossible (F6) : low = high est rejeté.
  constraint friendships_ordered_pair
    check (user_low_id < user_high_id),
  constraint friendships_requester_in_pair
    check (requester_id in (user_low_id, user_high_id)),
  -- Une ligne par duo, quel que soit le sens de création : l'unicité
  -- découle de la structure, pas du code (F1).
  constraint friendships_unique_pair
    unique (user_low_id, user_high_id)
);

comment on table public.friendships is
  'Friendship relation: one row per pair, ids stored in deterministic order (user_low_id < user_high_id), requester kept separately, two states (pending/accepted). Refusing and cancelling delete the row. Deny-total: reads go through get_friendships, writes through the request/accept/refuse/cancel/remove RPCs.';

-- Lookups « mes relations » côté high (l'unique couvre le côté low en tête
-- d'index) ; sert aussi la cascade F7 de la seconde FK.
create index if not exists friendships_user_high_id_idx
  on public.friendships (user_high_id);

-- updated_at : parité avec le reste du dépôt. Le seul UPDATE possible est
-- l'acceptation (pending → accepted) : updated_at date l'acceptation.
drop trigger if exists friendships_set_updated_at on public.friendships;
create trigger friendships_set_updated_at
  before update on public.friendships
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Bloc 3 : deny-total (précédent Phase I : user_stats). RLS activée sans
-- AUCUNE policy (couche 2) + aucun privilège pour les rôles applicatifs
-- (couche 1 : 42501 en direct). Une seule voie par opération.
-- ----------------------------------------------------------------------------

alter table public.friendships enable row level security;

revoke all on table public.friendships from public;
revoke all on table public.friendships from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Bloc 4.1 : RPC request_friendship — demander par pseudo exact (A2).
-- Retourne le statut RÉSULTANT : 'pending' (demande envoyée) ou 'accepted'
-- (demandes croisées, F5) — la même action a deux issues observables.
-- ----------------------------------------------------------------------------

create or replace function private.request_friendship(p_display_name text)
returns public.friendship_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_target_id uuid;
  v_low_id uuid;
  v_high_id uuid;
  v_status public.friendship_status;
  v_requester_id uuid;
begin
  -- 1. Identité du caller.
  v_caller_id := (select auth.uid());
  if v_caller_id is null then
    raise exception 'not_authenticated';
  end if;

  -- 2. Lookup de l'autre par pseudo : règle de recherche partagée (même
  -- mécanisme que le sélecteur — normalisation de l'unicité D.1).
  select account.user_id
    into v_target_id
    from private.find_account_by_display_name(p_display_name) as account;
  if v_target_id is null then
    raise exception 'display_name_not_found';
  end if;

  -- 3. Refus auto-demande (F6 — la contrainte ordered_pair est le filet).
  if v_target_id = v_caller_id then
    raise exception 'self_request';
  end if;

  -- 4. La ligne du duo, verrouillée : l'ordre déterministe (F1) fait que
  -- les deux sens de demande retombent sur la même ligne.
  v_low_id := least(v_caller_id, v_target_id);
  v_high_id := greatest(v_caller_id, v_target_id);

  select f.status, f.requester_id
    into v_status, v_requester_id
    from public.friendships f
   where f.user_low_id = v_low_id
     and f.user_high_id = v_high_id
     for update;

  if v_status = 'accepted' then
    raise exception 'already_friends';
  end if;

  if v_status = 'pending' and v_requester_id = v_caller_id then
    raise exception 'already_requested';
  end if;

  -- 5. Demandes croisées (F5/A7) : l'autre avait déjà demandé — la seconde
  -- demande ACCEPTE la ligne existante, elle ne crée pas de doublon.
  if v_status = 'pending' then
    update public.friendships
       set status = 'accepted'
     where user_low_id = v_low_id
       and user_high_id = v_high_id;
    return 'accepted';
  end if;

  -- 6. Première demande du duo : INSERT pending, en interceptant la
  -- contrainte unique (course concurrente entre le SELECT et l'INSERT —
  -- cf. en-tête ; auto-réparant au rappel).
  begin
    insert into public.friendships (user_low_id, user_high_id, requester_id)
    values (v_low_id, v_high_id, v_caller_id);
  exception
    when unique_violation then
      raise exception 'already_requested';
  end;

  return 'pending';
end;
$$;

revoke all on function private.request_friendship(text) from public;
grant execute on function private.request_friendship(text) to authenticated;

create or replace function public.request_friendship(p_display_name text)
returns public.friendship_status
language sql
security invoker
set search_path = ''
as $$
  select private.request_friendship(p_display_name);
$$;

revoke all on function public.request_friendship(text) from public;
revoke all on function public.request_friendship(text) from anon;
grant execute on function public.request_friendship(text) to authenticated;

comment on function public.request_friendship(text) is
  'Sends a friend request to the account matching the exact display name (same normalisation as display-name uniqueness). One row per pair in deterministic order: if the other person had already requested, the call accepts that request instead (crossed requests). Returns the resulting status: pending (request sent) or accepted (now friends). Raises typed errors: not_authenticated, display_name_not_found, self_request, already_requested, already_friends.';

-- ----------------------------------------------------------------------------
-- Bloc 4.2 : RPC accept_friendship — le destinataire SEUL accepte. La paire
-- est calculée depuis auth.uid() : impossible de viser la ligne d'un autre
-- duo ; se viser soi-même (ou NULL) → least = greatest → jamais de ligne
-- (ordered_pair) → request_not_found, sans garde dédiée.
-- ----------------------------------------------------------------------------

create or replace function private.accept_friendship(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_status public.friendship_status;
  v_requester_id uuid;
begin
  v_caller_id := (select auth.uid());
  if v_caller_id is null then
    raise exception 'not_authenticated';
  end if;

  select f.status, f.requester_id
    into v_status, v_requester_id
    from public.friendships f
   where f.user_low_id = least(v_caller_id, p_user_id)
     and f.user_high_id = greatest(v_caller_id, p_user_id)
     for update;

  -- Rien à accepter : ligne absente, ou relation déjà acceptée (le contrat
  -- d'accept porte sur une demande EN ATTENTE).
  if v_status is distinct from 'pending' then
    raise exception 'request_not_found';
  end if;

  -- On n'accepte que ce qui nous est ADRESSÉ : l'expéditeur ne peut pas
  -- accepter sa propre demande.
  if v_requester_id = v_caller_id then
    raise exception 'not_addressee';
  end if;

  update public.friendships
     set status = 'accepted'
   where user_low_id = least(v_caller_id, p_user_id)
     and user_high_id = greatest(v_caller_id, p_user_id);
end;
$$;

revoke all on function private.accept_friendship(uuid) from public;
grant execute on function private.accept_friendship(uuid) to authenticated;

create or replace function public.accept_friendship(p_user_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.accept_friendship(p_user_id);
$$;

revoke all on function public.accept_friendship(uuid) from public;
revoke all on function public.accept_friendship(uuid) from anon;
grant execute on function public.accept_friendship(uuid) to authenticated;

comment on function public.accept_friendship(uuid) is
  'Accepts the pending friend request sent by the given user to the caller. Addressee only: the sender cannot accept their own request (not_addressee). Raises typed errors: not_authenticated, request_not_found, not_addressee.';

-- ----------------------------------------------------------------------------
-- Bloc 4.3 : RPC refuse_friendship — le destinataire SEUL refuse ; le refus
-- SUPPRIME la ligne (A5/F4) : aucune trace, redemander marche. Ne vise que
-- les demandes en attente (retirer un ami = remove_friendship).
-- ----------------------------------------------------------------------------

create or replace function private.refuse_friendship(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_status public.friendship_status;
  v_requester_id uuid;
begin
  v_caller_id := (select auth.uid());
  if v_caller_id is null then
    raise exception 'not_authenticated';
  end if;

  select f.status, f.requester_id
    into v_status, v_requester_id
    from public.friendships f
   where f.user_low_id = least(v_caller_id, p_user_id)
     and f.user_high_id = greatest(v_caller_id, p_user_id)
     for update;

  if v_status is distinct from 'pending' then
    raise exception 'request_not_found';
  end if;

  if v_requester_id = v_caller_id then
    raise exception 'not_addressee';
  end if;

  delete from public.friendships
   where user_low_id = least(v_caller_id, p_user_id)
     and user_high_id = greatest(v_caller_id, p_user_id);
end;
$$;

revoke all on function private.refuse_friendship(uuid) from public;
grant execute on function private.refuse_friendship(uuid) to authenticated;

create or replace function public.refuse_friendship(p_user_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.refuse_friendship(p_user_id);
$$;

revoke all on function public.refuse_friendship(uuid) from public;
revoke all on function public.refuse_friendship(uuid) from anon;
grant execute on function public.refuse_friendship(uuid) to authenticated;

comment on function public.refuse_friendship(uuid) is
  'Refuses the pending friend request sent by the given user to the caller, by DELETING the row: no trace kept, requesting again works immediately. Addressee only. Raises typed errors: not_authenticated, request_not_found, not_addressee.';

-- ----------------------------------------------------------------------------
-- Bloc 4.4 : RPC cancel_friendship_request — le demandeur SEUL annule sa
-- propre demande, tant qu'elle est en attente (F8/A8). Action DÉDIÉE, pas
-- une extension du retrait : les droits diffèrent (retrait = les deux
-- parties d'une amitié acceptée ; annulation = le seul demandeur d'une
-- demande en attente). Supprime la ligne, comme le refus : aucune trace,
-- redemander marche. not_requester est le miroir de not_addressee.
-- ----------------------------------------------------------------------------

create or replace function private.cancel_friendship_request(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_status public.friendship_status;
  v_requester_id uuid;
begin
  v_caller_id := (select auth.uid());
  if v_caller_id is null then
    raise exception 'not_authenticated';
  end if;

  select f.status, f.requester_id
    into v_status, v_requester_id
    from public.friendships f
   where f.user_low_id = least(v_caller_id, p_user_id)
     and f.user_high_id = greatest(v_caller_id, p_user_id)
     for update;

  -- Rien à annuler : ligne absente, ou amitié déjà acceptée (annuler une
  -- amitié = remove_friendship, pas cancel).
  if v_status is distinct from 'pending' then
    raise exception 'request_not_found';
  end if;

  -- On n'annule que SA PROPRE demande : le destinataire refuse, il
  -- n'annule pas à la place du demandeur.
  if v_requester_id <> v_caller_id then
    raise exception 'not_requester';
  end if;

  delete from public.friendships
   where user_low_id = least(v_caller_id, p_user_id)
     and user_high_id = greatest(v_caller_id, p_user_id);
end;
$$;

revoke all on function private.cancel_friendship_request(uuid) from public;
grant execute on function private.cancel_friendship_request(uuid) to authenticated;

create or replace function public.cancel_friendship_request(p_user_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.cancel_friendship_request(p_user_id);
$$;

revoke all on function public.cancel_friendship_request(uuid) from public;
revoke all on function public.cancel_friendship_request(uuid) from anon;
grant execute on function public.cancel_friendship_request(uuid) to authenticated;

comment on function public.cancel_friendship_request(uuid) is
  'Cancels the caller''s own pending friend request to the given user, by DELETING the row: no trace kept, requesting again works. Requester only, pending only — refusing is the addressee''s move, removing targets accepted friendships. Raises typed errors: not_authenticated, request_not_found, not_requester.';

-- ----------------------------------------------------------------------------
-- Bloc 4.5 : RPC remove_friendship — retrait silencieux, unilatéral (A4),
-- IDEMPOTENT (précédent remove_tournament_member : cible introuvable =
-- no-op). La paire est calculée depuis auth.uid() : un tiers ne peut
-- STRUCTURELLEMENT pas viser la ligne d'un autre duo. Seules les amitiés
-- ACCEPTÉES sont concernées : une demande en attente s'annule
-- (cancel_friendship_request, demandeur) ou se refuse (refuse_friendship,
-- destinataire).
-- ----------------------------------------------------------------------------

create or replace function private.remove_friendship(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
begin
  v_caller_id := (select auth.uid());
  if v_caller_id is null then
    raise exception 'not_authenticated';
  end if;

  delete from public.friendships
   where user_low_id = least(v_caller_id, p_user_id)
     and user_high_id = greatest(v_caller_id, p_user_id)
     and status = 'accepted';
end;
$$;

revoke all on function private.remove_friendship(uuid) from public;
grant execute on function private.remove_friendship(uuid) to authenticated;

create or replace function public.remove_friendship(p_user_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.remove_friendship(p_user_id);
$$;

revoke all on function public.remove_friendship(uuid) from public;
revoke all on function public.remove_friendship(uuid) from anon;
grant execute on function public.remove_friendship(uuid) to authenticated;

comment on function public.remove_friendship(uuid) is
  'Removes an accepted friendship between the caller and the given user, from either side, silently. Idempotent: a missing friendship is a no-op. Pending requests are not affected (they are cancelled by their requester or refused by their addressee). Raises typed errors: not_authenticated.';

-- ----------------------------------------------------------------------------
-- Bloc 4.6 : RPC get_friendships — les trois listes directement utilisables
-- (amis / reçues / envoyées), chacune avec {user_id, display_name} de
-- l'AUTRE personne. Le json n'expose JAMAIS user_low_id / user_high_id ni
-- requester_id bruts : le client ne connaît pas l'ordre imposé. Le pseudo
-- est lu hors RLS (DEFINER) : même exposition que
-- find_account_by_display_name, limitée aux relations du caller.
-- ----------------------------------------------------------------------------

create or replace function private.get_friendships()
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := (select auth.uid());
begin
  if v_caller_id is null then
    raise exception 'not_authenticated';
  end if;

  return json_build_object(
    'friends', coalesce(
      (
        select json_agg(
          json_build_object(
            'user_id', friend_profile.id,
            'display_name', friend_profile.display_name
          )
          -- Tri TOTAL : alphabétique insensible à la casse (normalisation
          -- de l'unicité D.1), id en dernier.
          order by lower(friend_profile.display_name), friend_profile.id
        )
        from public.friendships f
        join public.profiles friend_profile
          on friend_profile.id = case
               when f.user_low_id = v_caller_id then f.user_high_id
               else f.user_low_id
             end
        where v_caller_id in (f.user_low_id, f.user_high_id)
          and f.status = 'accepted'
      ),
      '[]'::json
    ),
    'received', coalesce(
      (
        select json_agg(
          json_build_object(
            'user_id', requester_profile.id,
            'display_name', requester_profile.display_name
          )
          -- La plus récente d'abord ; id en dernier pour un ordre total.
          order by f.created_at desc, f.id desc
        )
        from public.friendships f
        join public.profiles requester_profile
          on requester_profile.id = f.requester_id
        where v_caller_id in (f.user_low_id, f.user_high_id)
          and f.status = 'pending'
          and f.requester_id <> v_caller_id
      ),
      '[]'::json
    ),
    'sent', coalesce(
      (
        select json_agg(
          json_build_object(
            'user_id', addressee_profile.id,
            'display_name', addressee_profile.display_name
          )
          order by f.created_at desc, f.id desc
        )
        from public.friendships f
        join public.profiles addressee_profile
          on addressee_profile.id = case
               when f.user_low_id = v_caller_id then f.user_high_id
               else f.user_low_id
             end
        -- Le prédicat de paire est redondant (requester ∈ duo par CHECK)
        -- mais sert les index low/high.
        where v_caller_id in (f.user_low_id, f.user_high_id)
          and f.status = 'pending'
          and f.requester_id = v_caller_id
      ),
      '[]'::json
    )
  );
end;
$$;

revoke all on function private.get_friendships() from public;
grant execute on function private.get_friendships() to authenticated;

create or replace function public.get_friendships()
returns json
language sql
security invoker
set search_path = ''
as $$
  select private.get_friendships();
$$;

revoke all on function public.get_friendships() from public;
revoke all on function public.get_friendships() from anon;
grant execute on function public.get_friendships() to authenticated;

comment on function public.get_friendships() is
  'Returns the caller''s relationships as a JSON bundle: { friends, received, sent }. Each entry exposes the other person only ({ user_id, display_name }); the stored pair order and raw requester are never revealed. Friends sorted alphabetically (case-insensitive), requests newest first, empty lists as []. Raises typed errors: not_authenticated.';

-- ----------------------------------------------------------------------------
-- Bloc 5 : assertions finales — toute anomalie annule la migration.
-- ----------------------------------------------------------------------------

do $$
declare
  private_rpcs_are_consistent boolean;
  request_consumes_shared_lookup boolean;
  wrappers_are_consistent boolean;
  authenticated_can_execute_all_wrappers boolean;
  anon_can_execute_a_wrapper boolean;
  named_constraints_count integer;
  cascade_fk_count integer;
  rls_is_enabled boolean;
  policy_count integer;
  authenticated_has_table_privilege boolean;
  anon_has_table_privilege boolean;
begin
  -- search_path = '' est stocké avec l'élément vide CITÉ : search_path="".
  select count(*) = 6
    into private_rpcs_are_consistent
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and p.proname in ('request_friendship', 'accept_friendship',
                       'refuse_friendship', 'cancel_friendship_request',
                       'remove_friendship', 'get_friendships')
     and p.prosecdef
     and 'search_path=""' = any(p.proconfig);

  select p.prosrc like '%private.find_account_by_display_name(%'
    into request_consumes_shared_lookup
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'request_friendship';

  select count(*) = 6
    into wrappers_are_consistent
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('request_friendship', 'accept_friendship',
                       'refuse_friendship', 'cancel_friendship_request',
                       'remove_friendship', 'get_friendships')
     and not p.prosecdef
     and 'search_path=""' = any(p.proconfig);

  select bool_and(has_function_privilege('authenticated', wrapper_signature, 'EXECUTE')),
         bool_or(has_function_privilege('anon', wrapper_signature, 'EXECUTE'))
    into authenticated_can_execute_all_wrappers, anon_can_execute_a_wrapper
    from unnest(array[
      'public.request_friendship(text)',
      'public.accept_friendship(uuid)',
      'public.refuse_friendship(uuid)',
      'public.cancel_friendship_request(uuid)',
      'public.remove_friendship(uuid)',
      'public.get_friendships()'
    ]) as wrapper_signature;

  select count(*)
    into named_constraints_count
    from pg_catalog.pg_constraint con
   where con.conrelid = 'public.friendships'::regclass
     and con.conname in ('friendships_ordered_pair',
                         'friendships_requester_in_pair',
                         'friendships_unique_pair');

  -- F7 : les deux colonnes du duo cascadent depuis auth.users.
  select count(*)
    into cascade_fk_count
    from pg_catalog.pg_constraint con
   where con.conrelid = 'public.friendships'::regclass
     and con.contype = 'f'
     and con.confrelid = 'auth.users'::regclass
     and con.confdeltype = 'c';

  select c.relrowsecurity
    into rls_is_enabled
    from pg_catalog.pg_class c
   where c.oid = 'public.friendships'::regclass;

  select count(*)
    into policy_count
    from pg_catalog.pg_policy pol
   where pol.polrelid = 'public.friendships'::regclass;

  select has_table_privilege('authenticated', 'public.friendships',
                             'SELECT, INSERT, UPDATE, DELETE')
    into authenticated_has_table_privilege;
  select has_table_privilege('anon', 'public.friendships',
                             'SELECT, INSERT, UPDATE, DELETE')
    into anon_has_table_privilege;

  if private_rpcs_are_consistent is distinct from true then
    raise exception 'friendship_schema: une RPC privée manque ou est incohérente (security definer / search_path)';
  end if;
  if request_consumes_shared_lookup is distinct from true then
    raise exception 'friendship_schema: request_friendship ne consomme pas la règle de recherche partagée';
  end if;
  if wrappers_are_consistent is distinct from true then
    raise exception 'friendship_schema: un wrapper public manque ou est incohérent (doit être INVOKER avec search_path)';
  end if;
  if authenticated_can_execute_all_wrappers is distinct from true then
    raise exception 'friendship_schema: authenticated doit pouvoir exécuter les 6 wrappers';
  end if;
  if anon_can_execute_a_wrapper then
    raise exception 'friendship_schema: anon ne doit exécuter aucun wrapper';
  end if;
  if named_constraints_count <> 3 then
    raise exception 'friendship_schema: les 3 contraintes nommées de friendships doivent exister (obtenu %)', named_constraints_count;
  end if;
  if cascade_fk_count <> 2 then
    raise exception 'friendship_schema: les deux FK du duo doivent cascader depuis auth.users (obtenu %)', cascade_fk_count;
  end if;
  if rls_is_enabled is distinct from true then
    raise exception 'friendship_schema: la RLS doit être activée sur friendships';
  end if;
  if policy_count <> 0 then
    raise exception 'friendship_schema: friendships est deny-total — AUCUNE policy attendue (obtenu %)', policy_count;
  end if;
  if authenticated_has_table_privilege then
    raise exception 'friendship_schema: authenticated ne doit avoir aucun privilège de table sur friendships';
  end if;
  if anon_has_table_privilege then
    raise exception 'friendship_schema: anon ne doit avoir aucun privilège de table sur friendships';
  end if;
end;
$$;
