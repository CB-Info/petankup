-- ============================================================================
-- 20260608144950_phase_d_1_display_name_uniqueness
-- Pétankup — Phase D.1 : unicité du pseudo + suffix aléatoire au signup.
--
--   1. Assertion défensive : aucun doublon lower(trim(display_name)) existant.
--   2. Remplace l'index non-unique de C.1 par un index UNIQUE sur
--      lower(trim(display_name)) (insensible casse + espaces de bord).
--   3. Ajoute le helper private.generate_random_alphanum(n int).
--   4. Réécrit private.handle_new_user_profile pour appliquer un suffix
--      aléatoire (ex. "Alice-x7K2") en cas de conflit de pseudo au signup.
--
-- Rappels schéma (C.1) à NE PAS casser :
--   - public.profiles a une PK `id` (= auth.users.id), PAS `user_id`.
--   - La fonction trigger vit dans `private` ; le trigger sur auth.users
--     pointe sur private.handle_new_user_profile. On remplace son corps
--     in-place via create or replace (aucun create trigger requis).
--   - C.1 s'appuie sur `on conflict (id) do nothing` pour l'idempotence
--     (re-fire du trigger / croisement backfill). On le conserve : il avale
--     les conflits de PK `id`, si bien qu'une unique_violation qui s'échappe
--     du INSERT ne peut être que le conflit display_name → bascule suffix.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Assertion défensive : aucun doublon préexistant
-- ----------------------------------------------------------------------------
-- Avant de poser un index unique, on échoue clairement si un doublon
-- existait déjà, plutôt que de laisser CREATE UNIQUE INDEX renvoyer un
-- message obscur.
do $$
declare
  duplicate_count int;
begin
  select count(*) into duplicate_count
  from (
    select 1
    from public.profiles
    group by lower(trim(display_name))
    having count(*) > 1
  ) duplicates;

  if duplicate_count > 0 then
    raise exception 'Cannot create unique index on display_name: % duplicate group(s) detected. Resolve manually before re-applying.', duplicate_count;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Index unique sur lower(trim(display_name))
-- ----------------------------------------------------------------------------
drop index if exists public.profiles_display_name_lower_idx;

create unique index profiles_display_name_lower_idx
  on public.profiles (lower(trim(display_name)));

comment on index public.profiles_display_name_lower_idx is
  'Unique index for case- and edge-space-insensitive uniqueness on display_name.';

-- ----------------------------------------------------------------------------
-- 3. Helper de génération de suffix aléatoire
-- ----------------------------------------------------------------------------
-- Génère n caractères alphanumériques (62 possibles : a-z, A-Z, 0-9).
-- Fonction pure (ne touche aucune table) → SECURITY INVOKER (défaut), pas
-- DEFINER. volatile (utilise random()), placée dans `private`, aucune
-- permission au PUBLIC : seule private.handle_new_user_profile l'appelle.
-- search_path = '' : les built-ins (random, floor, substr) restent
-- accessibles via pg_catalog, toujours implicitement en tête de search_path.
create or replace function private.generate_random_alphanum(n int)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet text := 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  result text := '';
  i int;
begin
  if n < 1 then
    raise exception 'generate_random_alphanum: n must be >= 1 (got %)', n;
  end if;

  for i in 1..n loop
    result := result || substr(alphabet, 1 + floor(random() * 62)::int, 1);
  end loop;

  return result;
end;
$$;

revoke all on function private.generate_random_alphanum(int) from public;

comment on function private.generate_random_alphanum(int) is
  'Generates a random alphanumeric string of length n. Used by handle_new_user_profile to disambiguate display_name collisions at signup.';

-- ----------------------------------------------------------------------------
-- 4. Trigger handle_new_user_profile avec suffix sur conflit
-- ----------------------------------------------------------------------------
-- Logique :
--   1. base_name = full_name (Google) → local-part email → 'Utilisateur '
--      + 8 chars de l'id (logique de fallback C.1 préservée à l'identique).
--   2. Premier essai : base tronqué à 50, on conflict (id) do nothing.
--   3. Si unique_violation (donc display_name, pas id) : mode suffix.
--   4. Suffix de longueur croissante (4 → 6 → 8), base tronqué à
--      50 - 1 - longueur_suffix pour respecter la CHECK (<= 50).
--   5. Au-delà de 3 essais : RAISE EXCEPTION (probabilité astronomique).
create or replace function private.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_name text;
  candidate_name text;
  attempt_count int := 0;
  suffix_length int;
  max_base_length int;
begin
  -- base_name : logique de fallback C.1 préservée à l'identique.
  base_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(split_part(new.email, '@', 1), ''),
    'Utilisateur ' || substring(new.id::text, 1, 8)
  );

  -- Premier essai : base tronqué à 50. `on conflict (id) do nothing`
  -- préserve l'idempotence C.1 ; une unique_violation qui s'échappe ici
  -- ne peut donc être que le conflit display_name → bascule mode suffix.
  candidate_name := left(base_name, 50);
  begin
    insert into public.profiles (id, display_name)
    values (new.id, candidate_name)
    on conflict (id) do nothing;
    return new;
  exception when unique_violation then
    null; -- conflit display_name : on passe à la boucle de suffix
  end;

  -- Boucle de tentatives avec suffix de longueur croissante.
  loop
    attempt_count := attempt_count + 1;
    suffix_length := case attempt_count
      when 1 then 4
      when 2 then 6
      when 3 then 8
      else null
    end;

    if suffix_length is null then
      raise exception 'handle_new_user_profile: unable to generate unique display_name after 3 attempts (base=%)', base_name;
    end if;

    -- base + '-' + suffix doit tenir dans 50 chars.
    max_base_length := 50 - 1 - suffix_length;
    candidate_name := left(base_name, max_base_length)
                   || '-'
                   || private.generate_random_alphanum(suffix_length);

    begin
      insert into public.profiles (id, display_name)
      values (new.id, candidate_name)
      on conflict (id) do nothing;
      return new;
    exception when unique_violation then
      continue; -- collision display_name même avec ce suffix : on réessaie
    end;
  end loop;
end;
$$;

revoke all on function private.handle_new_user_profile() from public;

comment on function private.handle_new_user_profile() is
  'Trigger function on auth.users INSERT. Creates a public.profiles row with display_name derived from raw_user_meta_data->>full_name. Applies a random suffix (e.g. "Alice-x7K2") on conflict to ensure uniqueness.';

-- ----------------------------------------------------------------------------
-- Le trigger handle_new_user_profile sur auth.users est déjà attaché depuis
-- C.1 et pointe sur private.handle_new_user_profile. Le create or replace
-- ci-dessus remplace son corps in-place — aucune action supplémentaire.
-- ----------------------------------------------------------------------------
