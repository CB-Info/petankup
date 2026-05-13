-- ============================================================================
-- 20260512120000_phase_c_1_profiles_foundation
-- Pétankup — Phase C.1 : foundation des profils utilisateurs.
--   - Table public.profiles (id, display_name, timestamps).
--   - Trigger AFTER INSERT ON auth.users → private.handle_new_user_profile().
--   - Helper RLS private.users_share_visible_tournament(uuid).
--   - 3 policies sur profiles (SELECT visible, INSERT self, UPDATE self).
--   - Backfill INSERT pour les auth.users existants.
--
-- Décisions ancrées (cf. cadrage Phase C v2) :
--   - profiles ne contient PAS d'email. L'email vit dans auth.users
--     (accessible à soi via useSupabaseUser) et dans
--     tournament_members.member_email (snapshot d'invitation).
--   - display_name est NOT NULL côté DB grâce au trigger ; côté
--     produit, optionnel (l'utilisateur ne le choisit pas forcément,
--     le trigger fournit un fallback).
--   - Pas d'unicité du pseudo en V1. Index lower(trim(...)) posé
--     pour préparer une future recherche.
--   - Visibilité scopée par co-tournoi avec granularité fine
--     (cf. bloc 5).
--   - RLS contrôle les lignes, pas les colonnes : un user autorisé
--     à SELECT une ligne lit id + display_name + created_at +
--     updated_at. Aucune n'est sensible.
--
-- Invariant à préserver : aucune policy de tournaments, teams,
-- matches, ou tournament_members ne doit dépendre de profiles. Le
-- helper users_share_visible_tournament (bloc 5) interroge ces
-- tables directement (EXISTS) et est protégé contre la récursion
-- par SECURITY DEFINER qui bypass leurs RLS. À re-vérifier à chaque
-- ajout de policy sur ces tables.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Table public.profiles
-- ----------------------------------------------------------------------------

create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint profiles_display_name_length
    check (char_length(trim(display_name)) between 1 and 50)
);

-- ----------------------------------------------------------------------------
-- 2. Indexes
-- ----------------------------------------------------------------------------

-- Index posé pour préparer une future recherche par pseudo
-- case-insensitive et trim-insensitive. Non unique en V1 (D2 du
-- cadrage : un même pseudo peut être utilisé par plusieurs amis).
create index if not exists profiles_display_name_lower_idx
  on public.profiles (lower(trim(display_name)));

-- ----------------------------------------------------------------------------
-- 3. Trigger updated_at
-- ----------------------------------------------------------------------------

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. Fonction trigger de création de profil
-- ----------------------------------------------------------------------------
-- Vit en `private` (non exposé à PostgREST), SECURITY DEFINER pour
-- INSERT dans public.profiles dans le contexte du nouvel auth.users.
-- search_path = '' explicite (pas de dépendance à la config session).
--
-- Pas de grant execute applicatif : appelée uniquement par le trigger.
--
-- Cascade de fallback display_name (R5 du cadrage v2) :
--   1. raw_user_meta_data->>'full_name' (Google OAuth).
--   2. local-part email (avant le @).
--   3. 'Utilisateur ' + 8 premiers chars de l'id (cas tordu : email
--      NULL et pas de full_name).
--
-- `left(..., 50)` final pour respecter la CHECK constraint. Un
-- full_name Google long ou un local-part long ferait sinon échouer
-- le trigger — et potentiellement bloquerait la création du compte.
-- Troncature silencieuse préférable à une erreur opaque.
--
-- on conflict (id) do nothing pour idempotence (trigger qui fire 2x
-- ou trigger qui se croise avec le backfill).

create or replace function private.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text;
begin
  v_display_name := left(coalesce(
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(split_part(new.email, '@', 1), ''),
    'Utilisateur ' || substring(new.id::text, 1, 8)
  ), 50);

  insert into public.profiles (id, display_name)
  values (new.id, v_display_name)
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function private.handle_new_user_profile() from public;

drop trigger if exists handle_new_user_profile on auth.users;
create trigger handle_new_user_profile
  after insert on auth.users
  for each row execute function private.handle_new_user_profile();

-- ----------------------------------------------------------------------------
-- 5. Helper RLS — visibilité scopée par co-tournoi avec granularité fine
-- ----------------------------------------------------------------------------
-- Retourne true ssi le profil de profile_id doit être lisible par le
-- current user. Distingue le mode de partage du tournoi t qui lie
-- les deux users :
--
--   - owner d'un tournoi t : voit le profil owner + tous les membres
--     invités de t.
--   - membre invité de t : voit le profil de l'owner + des autres
--     membres invités de t.
--   - simple visiteur d'un tournoi public t (ni owner ni membre,
--     juste un user authentifié qui voit t via visibility='public') :
--     voit UNIQUEMENT le profil de l'owner de t, PAS ceux des membres.
--
-- N'UTILISE PAS private.tournament_is_visible_to_current_user (B.1)
-- car celui-ci traite owner / public / membre uniformément. Ici on
-- DOIT discriminer pour ne pas leak les profils des membres invités
-- d'un tournoi public à un simple visiteur. Léger doublon de logique
-- entre les deux helpers, assumé.
--
-- SECURITY DEFINER pour bypasser RLS sur tournaments et
-- tournament_members lors des EXISTS. search_path = '' obligatoire.
-- stable : déterministe par transaction, ne mute pas — autorise
-- l'optimiseur à partager les évaluations multiples au sein d'une
-- même requête.

create or replace function private.users_share_visible_tournament(profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Branche 1 : profile_id est OWNER d'un tournoi t.
  -- Current user peut le voir si owner de t, OU public, OU membre.
  -- C'est cette branche qui autorise "Tournoi de Alice" sur les
  -- cartes publiques pour D non-invité.
  select exists (
    select 1
      from public.tournaments t
     where t.owner_id = profile_id
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
  )
  -- Branche 2 : profile_id est MEMBRE d'un tournoi t.
  -- Current user peut le voir si owner de t OU membre de t.
  -- PAS si simple visiteur public — c'est ici qu'on coupe la fuite.
  or exists (
    select 1
      from public.tournament_members target_m
      inner join public.tournaments t
        on t.id = target_m.tournament_id
     where target_m.user_id = profile_id
       and (
         t.owner_id = (select auth.uid())
         or exists (
           select 1
             from public.tournament_members caller_m
            where caller_m.tournament_id = t.id
              and caller_m.user_id = (select auth.uid())
         )
       )
  );
$$;

revoke all on function private.users_share_visible_tournament(uuid) from public;
grant execute on function private.users_share_visible_tournament(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. RLS + policies sur profiles
-- ----------------------------------------------------------------------------

alter table public.profiles enable row level security;

-- SELECT : self ou co-tournoi visible. Cf. helper ci-dessus.
drop policy if exists "profiles_select_visible" on public.profiles;
create policy "profiles_select_visible"
  on public.profiles
  for select
  to authenticated
  using (
    id = (select auth.uid())
    or private.users_share_visible_tournament(id)
  );

-- INSERT : defense in depth. Le trigger crée déjà le profil à la
-- création du compte. Cette policy autorise un INSERT direct via
-- PostgREST uniquement pour soi-même (permet un éventuel retry app).
drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self"
  on public.profiles
  for insert
  to authenticated
  with check (id = (select auth.uid()));

-- UPDATE : self uniquement, id immutable. with check empêche un
-- user de réécrire son id pour usurper celui d'un autre.
drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Pas de policy DELETE : la cascade depuis auth.users(id) suffit.

-- ----------------------------------------------------------------------------
-- 6.bis. Grants — defense-in-depth en column-level
-- ----------------------------------------------------------------------------
-- Sans grant approprié, PostgREST renvoie `permission denied for
-- table profiles` même quand la RLS dit "go". Grants column-level
-- pour expliciter la surface minimale :
--   - SELECT : toute la table (RLS contrôle déjà la visibilité ligne).
--   - INSERT : (id, display_name). created_at/updated_at ont
--     `default now()`, le caller n'a pas à les spécifier ni à les
--     truquer.
--   - UPDATE : (display_name) seulement. id figé (en plus de la
--     policy `with check`), created_at/updated_at hors d'atteinte
--     du caller. La mise à jour de updated_at se fait par le
--     trigger BEFORE UPDATE (modifie NEW indépendamment des grants).
--   - Pas de DELETE — cohérent avec l'absence de policy DELETE.
--
-- revoke initial cible PUBLIC + anon + authenticated. Le revoke PUBLIC
-- coupe explicitement les grants implicites au pseudo-rôle PUBLIC.
-- anon ne reçoit ensuite aucun grant : aucune voie d'accès anonyme.

revoke all on table public.profiles from public;
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant insert (id, display_name) on table public.profiles to authenticated;
grant update (display_name) on table public.profiles to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Backfill des auth.users existants
-- ----------------------------------------------------------------------------
-- Tous les users créés avant l'application de la migration doivent
-- avoir un profil, sinon le frontend (C.2/C.3) tombera sur des cas
-- "user existe mais pas de profil".
--
-- Même logique de fallback que dans le trigger, avec le même
-- `left(..., 50)` pour respecter la CHECK. on conflict (id) do
-- nothing pour rejouabilité.

insert into public.profiles (id, display_name)
select
  u.id,
  left(coalesce(
    nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
    nullif(split_part(u.email, '@', 1), ''),
    'Utilisateur ' || substring(u.id::text, 1, 8)
  ), 50)
from auth.users u
on conflict (id) do nothing;
