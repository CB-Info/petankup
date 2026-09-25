-- ============================================================================
-- 20260925120000_match_lifecycle_guard
-- Pétankup — interdire les matchs sur un brouillon (lot DB-2, dernier des
-- trois : DB-1 start_tournament → APP bascule → DB-2 garde).
--
-- Source : ticket DB-2 « interdire les matchs sur un brouillon » et la revue
-- adverse du lot APP (lot incomplet accepté si une équipe est ajoutée
-- ailleurs entre l'affichage et le clic).
--
-- Le manque : DB-1 a rendu le démarrage atomique et l'application déployée
-- passe par lui, mais rien en base n'interdisait l'état cassé — des matchs
-- sur un brouillon, invisibles et impossibles à régénérer. L'insertion
-- directe des matchs restait ouverte aux clients (politique RLS
-- tournament_matches_insert_own + privilèges par défaut du projet) alors
-- que plus rien ne l'utilise. Et un tournoi en cours pouvait repasser en
-- brouillon (seul terminé → brouillon était bloqué par le gel), autre chemin
-- vers le même état.
--
-- Un brouillon ne peut gagner un match que par quatre chemins, tous fermés
-- ici :
--   Bloc 1 : INSERT d'un match (ou re-parentage par UPDATE de tournament_id)
--            sur un brouillon → trigger, refus typé 'tournament_not_started'.
--            Les FK composites (team_x_id, tournament_id) forcent
--            tournament_id à suivre les équipes : déplacer un match exige
--            tournament_id dans le SET, donc passe par cette garde.
--   Bloc 2 : régression de statut vers draft → trigger, refus typé
--            'tournament_started' (completed → draft garde son code
--            'tournament_completed' : le gel lève d'abord, cf. ordre) ; et
--            création d'un tournoi EN BROUILLON alors que des matchs le
--            référencent déjà → trigger BEFORE INSERT, 'tournament_not_started'.
--            Ce dernier chemin n'existe qu'en UNE instruction (CTE
--            modifiantes : le match inséré avant son tournoi, les FK vérifiées
--            en fin d'instruction) pour un rôle qui contourne la RLS — trouvé
--            par la revue adverse. Avec une garde BEFORE des deux côtés, la
--            ligne écrite en second voit toujours la première.
--   Bloc 3 : le chemin direct est fermé aux clients — politique INSERT
--            retirée ET privilège INSERT révoqué (42501 avant même la RLS).
--            La seule voie d'entrée d'un match est private.start_tournament,
--            SECURITY DEFINER, qui passe le statut en cours AVANT d'insérer
--            (même transaction). Lecture, saisie de score (UPDATE) et
--            suppressions en cascade (tournoi → matchs, équipe → matchs) ne
--            changent pas : les suppressions en cascade (ON DELETE CASCADE)
--            ne déclenchent pas les triggers INSERT/UPDATE et contournent la
--            RLS.
--   Bloc 4 : private.start_tournament exige un lot COMPLET — toutes les
--            paires d'équipes du tournoi — sinon 'incomplete_matches'. Elle
--            ne recalcule pas le lot, elle vérifie qu'il est complet (les
--            règles de génération restent côté application).
--   Bloc 0 : sûreté avant de poser la garde — un brouillon avec matchs
--            existant rendrait l'état invalide ; la migration s'arrête.
--   Bloc 5 : assertions finales sur le catalogue.
--
-- Ce qui reste ouvert, par choix documenté (hors périmètre) : un UPDATE
-- direct draft → in_progress d'un tournoi sans match (l'app ne le fait
-- plus ; il ne crée pas de match sur un brouillon) ; l'ajout d'une équipe à
-- un tournoi en cours, la suppression ou la modification des équipes d'un
-- match par l'organisateur sur un tournoi en cours (politiques update /
-- delete intactes, l'app ne le fait pas) — le lot complet est une règle du
-- démarrage, pas un invariant rétroactif. Et, inhérent à toute garde par
-- trigger : le propriétaire de la table peut la désactiver (DISABLE
-- TRIGGER, session_replication_role) — hors périmètre.
--
-- Idempotence : create or replace, drop trigger if exists, drop policy if
-- exists, revoke rejouables. Rejouée deux fois sans erreur.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bloc 0 : sûreté — aucun brouillon ne doit déjà porter des matchs.
-- db push exécute le fichier dans une transaction : lever ici abandonne la
-- migration entière. Sur une base vide (stack locale), sans effet.
-- ----------------------------------------------------------------------------

do $$
declare
  offending_ids text;
begin
  select string_agg(t.id::text, ', ' order by t.id)
    into offending_ids
    from public.tournaments t
   where t.status = 'draft'
     and exists (
       select 1 from public.tournament_matches m
        where m.tournament_id = t.id
     );

  if offending_ids is not null then
    raise exception 'match_lifecycle_guard: brouillons avec matchs, à corriger avant la garde : %',
      offending_ids;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Bloc 1 : garde des matchs — aucun match sur un brouillon, quel que soit
-- le chemin DML tant que le trigger est actif (rôles applicatifs, RPC,
-- postgres, service_role : un trigger ne dépend pas des privilèges).
--
-- SECURITY DEFINER, en défense en profondeur : la fonction lit
-- public.tournaments, et un trigger s'exécute avec les droits du statement.
-- Aujourd'hui aucun rôle soumis à la RLS n'a INSERT sur les matchs (Bloc 3) ;
-- s'il le retrouvait un jour, en INVOKER une ligne masquée passerait pour
-- « pas un brouillon » et la garde s'ouvrirait. En DEFINER la ligne est
-- toujours vue quand elle existe. Un tournoi inexistant n'est pas un
-- brouillon : la FK répond ensuite (23503), pas un faux code — et s'il naît
-- en brouillon plus tard dans la même instruction, c'est la garde du Bloc 2
-- (insertion) qui répond.
--
-- BEFORE : porte la plus externe, miroir de l'ordre « statut d'abord » de
-- start_tournament — rien n'est écrit puis rejeté. Sur UPDATE, ne fire que
-- si tournament_id est dans le SET (UPDATE OF) ; sortie anticipée s'il n'a
-- pas changé (l'app n'envoie jamais cette colonne, filet peu coûteux).
-- ----------------------------------------------------------------------------

create or replace function private.match_lifecycle_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.tournament_id = old.tournament_id then
    return new;
  end if;

  if exists (
    select 1 from public.tournaments t
     where t.id = new.tournament_id and t.status = 'draft'
  ) then
    raise exception 'tournament_not_started';
  end if;

  return new;
end;
$$;

revoke all on function private.match_lifecycle_guard() from public;

drop trigger if exists tournament_matches_lifecycle_guard on public.tournament_matches;
create trigger tournament_matches_lifecycle_guard
  before insert or update of tournament_id on public.tournament_matches
  for each row execute function private.match_lifecycle_guard();

-- ----------------------------------------------------------------------------
-- Bloc 2 : jamais de retour en Brouillon (règle produit, CLAUDE.md « Jamais
-- de retour en Brouillon »). in_progress → draft est refusé ici ;
-- completed → draft l'était déjà par le gel.
--
-- INVOKER (défaut) : ne lit que OLD/NEW, aucun accès table — même choix que
-- tournament_freeze_guard. Ne fait que lever, n'assigne jamais new.status
-- (invariant du gel : les triggers AFTER UPDATE OF status restent fiables).
--
-- Ordre des BEFORE UPDATE (alphabétique) : tournaments_freeze_guard <
-- tournaments_lifecycle_guard < tournaments_set_completed_at <
-- tournaments_set_updated_at. Sur completed → draft, le gel lève d'abord
-- ('tournament_completed', épinglé par tournament_freeze_check cas 3c) ;
-- cette garde ne voit que les régressions depuis in_progress. Dépendance
-- au nom : ce trigger doit trier APRÈS tournaments_freeze_guard.
-- ----------------------------------------------------------------------------

create or replace function private.tournament_lifecycle_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'draft' and old.status is distinct from 'draft' then
    raise exception 'tournament_started';
  end if;
  return new;
end;
$$;

revoke all on function private.tournament_lifecycle_guard() from public;

drop trigger if exists tournaments_lifecycle_guard on public.tournaments;
create trigger tournaments_lifecycle_guard
  before update of status on public.tournaments
  for each row execute function private.tournament_lifecycle_guard();

-- Côté insertion : un tournoi qui naît en brouillon ne doit être référencé
-- par aucun match. Séquentiellement, c'est impossible (la FK exige le
-- tournoi avant le match, et le Bloc 1 refuse alors le match) ; en UNE
-- instruction à CTE modifiantes, le match peut être écrit avant son tournoi.
-- SECURITY DEFINER : lit public.tournament_matches. Le WHEN limite le coût à
-- la création d'un brouillon (une recherche indexée, jamais de ligne pour un
-- id neuf).
-- ----------------------------------------------------------------------------

create or replace function private.tournament_insert_lifecycle_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.tournament_matches m
     where m.tournament_id = new.id
  ) then
    raise exception 'tournament_not_started';
  end if;
  return new;
end;
$$;

revoke all on function private.tournament_insert_lifecycle_guard() from public;

drop trigger if exists tournaments_lifecycle_guard_insert on public.tournaments;
create trigger tournaments_lifecycle_guard_insert
  before insert on public.tournaments
  for each row when (new.status = 'draft')
  execute function private.tournament_insert_lifecycle_guard();

-- ----------------------------------------------------------------------------
-- Bloc 3 : fermeture du chemin direct — deux couches (précédent
-- free_match_schema) : plus de politique INSERT (couche RLS), plus de
-- privilège INSERT pour les rôles applicatifs (couche privilèges, 42501 en
-- direct). Les privilèges de ces tables n'avaient jamais été énoncés (grants
-- par défaut du projet) : le revoke est explicite, et durable — ALTER
-- DEFAULT PRIVILEGES ne s'applique qu'aux objets créés ensuite, seul un
-- GRANT explicite pourrait rouvrir le chemin. service_role n'est pas
-- concerné (le trigger du Bloc 1 le couvre). select / update / delete :
-- politiques et privilèges intacts — la saisie de score et les suppressions
-- continuent (parité avec public.teams vérifiée au Bloc 5).
-- ----------------------------------------------------------------------------

drop policy if exists tournament_matches_insert_own on public.tournament_matches;

revoke insert on table public.tournament_matches from public;
revoke insert on table public.tournament_matches from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Bloc 4 : private.start_tournament — le lot doit être complet.
--
-- Corps de DB-1 (20260912120000) réémis en entier ; un seul ajout, entre le
-- contrôle de forme et l'écriture du statut : le lot compte au moins
-- n(n-1)/2 éléments, n = équipes du tournoi. Pourquoi cela suffit : chaque
-- élément inséré référence deux équipes DISTINCTES de CE tournoi, et l'index
-- unique (tournament_id, least, greatest) interdit toute paire en double,
-- ordre inversé compris — les lignes insérées sont donc une injection dans
-- les n(n-1)/2 paires possibles. Un lot de cette longueur entièrement inséré
-- les couvre toutes ; un lot plus long contient forcément un doublon ou une
-- équipe étrangère, déjà refusés en 'invalid_matches'. « < » et non « <> » :
-- un lot trop long doit rester un lot invalide (cas épinglés de DB-1).
--
-- Concurrence : la ligne du tournoi est verrouillée FOR UPDATE dès le gate
-- propriétaire ; un ajout d'équipe concurrent prend FOR KEY SHARE sur cette
-- même ligne (FK teams → tournaments) et se sérialise avant ou après le
-- démarrage entier. Une suppression d'équipe concurrente donne
-- 'invalid_matches' (tout ou rien) ou cascade après : l'ensemble restant est
-- toujours un round-robin complet.
--
-- La garde 'matches_already_generated' devient défense en profondeur : avec
-- le Bloc 1, un brouillon n'a plus jamais de match.
-- ----------------------------------------------------------------------------

create or replace function private.start_tournament(
  p_tournament_id uuid,
  p_matches jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_team_count integer;
  v_expected_match_count integer;
  v_match jsonb;
  v_match_id uuid;
  v_team_a_id uuid;
  v_team_b_id uuid;
  v_round_number integer;
begin
  v_caller_id := (select auth.uid());
  if v_caller_id is null then
    raise exception 'not_authenticated';
  end if;

  -- Inexistant ou d'un autre propriétaire : même refus (anti-fuite). La
  -- ligne est verrouillée (FOR UPDATE) : deux lancements concurrents du
  -- même brouillon (double appui, deux onglets) se sérialisent, et le second
  -- relit un statut déjà passé en cours — tournament_not_draft, pas un refus
  -- de lot sur l'index unique.
  perform 1
    from public.tournaments t
   where t.id = p_tournament_id and t.owner_id = v_caller_id
     for update;
  if not found then
    raise exception 'not_owner';
  end if;

  -- Lancé ailleurs (in_progress) ou terminé : ce n'est plus un brouillon.
  if not exists (
    select 1 from public.tournaments t
     where t.id = p_tournament_id and t.status = 'draft'
  ) then
    raise exception 'tournament_not_draft';
  end if;

  select count(*) into v_team_count
    from public.teams te
   where te.tournament_id = p_tournament_id;
  if v_team_count < 2 then
    raise exception 'not_enough_teams';
  end if;

  -- Défense en profondeur : depuis DB-2, un brouillon n'a jamais de match
  -- (trigger tournament_matches_lifecycle_guard). Conservée : refus typé si
  -- la garde était un jour retirée.
  if exists (
    select 1 from public.tournament_matches m
     where m.tournament_id = p_tournament_id
  ) then
    raise exception 'matches_already_generated';
  end if;

  if p_matches is null
     or jsonb_typeof(p_matches) <> 'array'
     or jsonb_array_length(p_matches) < 1 then
    raise exception 'invalid_matches';
  end if;

  -- Lot complet : toutes les paires d'équipes (cf. bannière du Bloc 4). Le
  -- lot vient de l'application ; la base vérifie, elle ne recalcule pas.
  v_expected_match_count := v_team_count * (v_team_count - 1) / 2;
  if jsonb_array_length(p_matches) < v_expected_match_count then
    raise exception 'incomplete_matches';
  end if;

  -- Écriture 1 : le statut d'abord — la garde du Bloc 1 refuse tout match
  -- sur un brouillon. updated_at est horodaté par le trigger
  -- tournaments_set_updated_at.
  update public.tournaments
     set status = 'in_progress'
   where id = p_tournament_id;

  -- Écriture 2 : les matchs, chacun vérifié avant insertion.
  for v_match in select value from jsonb_array_elements(p_matches)
  loop
    if jsonb_typeof(v_match) <> 'object' then
      raise exception 'invalid_matches';
    end if;

    -- Conversions : une valeur mal formée (22P02, 22003) est un lot invalide,
    -- jamais un message technique. Une valeur absente donne null, refusé
    -- juste après. Conversions PostgreSQL ordinaires : une manche « 1 » en
    -- texte ou un uuid en majuscules passent — le lot vient de l'application.
    begin
      v_match_id := (v_match->>'id')::uuid;
      v_team_a_id := (v_match->>'team_a_id')::uuid;
      v_team_b_id := (v_match->>'team_b_id')::uuid;
      v_round_number := (v_match->>'round_number')::integer;
    exception when others then
      raise exception 'invalid_matches';
    end;

    if v_match_id is null
       or v_team_a_id is null
       or v_team_b_id is null
       or v_round_number is null
       or v_round_number < 1
       or v_team_a_id = v_team_b_id then
      raise exception 'invalid_matches';
    end if;

    -- Les deux équipes appartiennent à CE tournoi (les clés composites le
    -- garantissent aussi ; vérifié ici pour un refus typé, pas un 23503).
    if not exists (
      select 1 from public.teams te
       where te.id = v_team_a_id and te.tournament_id = p_tournament_id
    ) or not exists (
      select 1 from public.teams te
       where te.id = v_team_b_id and te.tournament_id = p_tournament_id
    ) then
      raise exception 'invalid_matches';
    end if;

    insert into public.tournament_matches
      (id, tournament_id, team_a_id, team_b_id, status, round_number)
    values
      (v_match_id, p_tournament_id, v_team_a_id, v_team_b_id, 'pending', v_round_number);
  end loop;
exception
  -- Filet : paire ou id en double dans le lot (index unique, clé primaire),
  -- clé étrangère, CHECK — même refus typé. Les raise ci-dessus (P0001) ne
  -- sont pas concernés et remontent tels quels. Toute exception annule les
  -- deux écritures : le tournoi reste en brouillon, sans match.
  when unique_violation or foreign_key_violation or check_violation then
    raise exception 'invalid_matches';
end;
$$;

revoke all on function private.start_tournament(uuid, jsonb) from public;
grant execute on function private.start_tournament(uuid, jsonb) to authenticated;

-- L'enveloppe publique de DB-1 (SECURITY INVOKER, EXECUTE à authenticated)
-- est inchangée ; seul son commentaire de catalogue gagne le nouveau code.
comment on function public.start_tournament(uuid, jsonb) is
  'Starts a draft tournament in a single transaction: moves it to in_progress, then inserts the given matches — generated by the application as [{id, team_a_id, team_b_id, round_number}], stored as pending without scores. Owner only. The batch must cover every pair of teams of the tournament (checked, not recomputed). Raises typed errors: not_authenticated, not_owner, tournament_not_draft, not_enough_teams, matches_already_generated, invalid_matches, incomplete_matches. Any error rolls back both writes.';

-- ----------------------------------------------------------------------------
-- Bloc 5 : assertions finales — l'état voulu, relu dans le catalogue. Un
-- écart abandonne la migration (db push = une transaction).
-- ----------------------------------------------------------------------------

do $$
declare
  match_guard record;
  tournament_guard record;
  tournament_insert_guard record;
  freeze_guard_name text;
  lifecycle_guard_name text;
  remaining_policy_commands text;
  tournament_id_attnum int2;
  status_attnum int2;
  privilege_name text;
  role_name text;
begin
  select attnum into tournament_id_attnum
    from pg_catalog.pg_attribute
   where attrelid = 'public.tournament_matches'::regclass and attname = 'tournament_id';
  select attnum into status_attnum
    from pg_catalog.pg_attribute
   where attrelid = 'public.tournaments'::regclass and attname = 'status';

  -- Trigger des matchs : BEFORE ROW, INSERT OR UPDATE OF tournament_id,
  -- actif. tgtype 23 = ROW(1) + BEFORE(2) + INSERT(4) + UPDATE(16). La liste
  -- de colonnes (int2vector, indexée à partir de 0) est comparée en texte.
  select tgtype, tgenabled, array_to_string(tgattr::int2[], ',') as columns
    into match_guard
    from pg_catalog.pg_trigger
   where tgrelid = 'public.tournament_matches'::regclass
     and tgname = 'tournament_matches_lifecycle_guard';
  if match_guard is null
     or match_guard.tgtype <> 23
     or match_guard.tgenabled <> 'O'
     or match_guard.columns <> tournament_id_attnum::text then
    raise exception 'match_lifecycle_guard: trigger tournament_matches_lifecycle_guard absent ou mal défini';
  end if;

  -- Trigger des tournois : BEFORE ROW, UPDATE OF status, actif.
  -- tgtype 19 = ROW(1) + BEFORE(2) + UPDATE(16).
  select tgtype, tgenabled, array_to_string(tgattr::int2[], ',') as columns
    into tournament_guard
    from pg_catalog.pg_trigger
   where tgrelid = 'public.tournaments'::regclass
     and tgname = 'tournaments_lifecycle_guard';
  if tournament_guard is null
     or tournament_guard.tgtype <> 19
     or tournament_guard.tgenabled <> 'O'
     or tournament_guard.columns <> status_attnum::text then
    raise exception 'match_lifecycle_guard: trigger tournaments_lifecycle_guard absent ou mal défini';
  end if;

  -- Trigger d'insertion des tournois : BEFORE ROW INSERT (tgtype 7 = ROW(1)
  -- + BEFORE(2) + INSERT(4)), actif, avec sa clause WHEN.
  select tgtype, tgenabled, tgqual is not null as has_when_clause
    into tournament_insert_guard
    from pg_catalog.pg_trigger
   where tgrelid = 'public.tournaments'::regclass
     and tgname = 'tournaments_lifecycle_guard_insert';
  if tournament_insert_guard is null
     or tournament_insert_guard.tgtype <> 7
     or tournament_insert_guard.tgenabled <> 'O'
     or not tournament_insert_guard.has_when_clause then
    raise exception 'match_lifecycle_guard: trigger tournaments_lifecycle_guard_insert absent ou mal défini';
  end if;

  -- Dépendance d'ordre, lue dans le catalogue : les triggers BEFORE UPDATE
  -- d'une table se déclenchent par ordre de nom (octets) ; le gel doit venir
  -- avant la garde de cycle de vie, quel que soit le nom qu'ils portent.
  select freeze_trigger.tgname::text, lifecycle_trigger.tgname::text
    into freeze_guard_name, lifecycle_guard_name
    from pg_catalog.pg_trigger freeze_trigger, pg_catalog.pg_trigger lifecycle_trigger
   where freeze_trigger.tgrelid = 'public.tournaments'::regclass
     and freeze_trigger.tgfoid = 'private.tournament_freeze_guard()'::regprocedure
     and lifecycle_trigger.tgrelid = 'public.tournaments'::regclass
     and lifecycle_trigger.tgfoid = 'private.tournament_lifecycle_guard()'::regprocedure;
  if freeze_guard_name is null or lifecycle_guard_name is null
     or not (freeze_guard_name collate "C" < lifecycle_guard_name collate "C") then
    raise exception 'match_lifecycle_guard: ordre des triggers de tournaments cassé (% doit précéder %)',
      freeze_guard_name, lifecycle_guard_name;
  end if;

  -- Sécurité des fonctions : DEFINER pour la garde des matchs (lit
  -- tournaments), INVOKER pour la garde des tournois, search_path vide sur
  -- les deux et sur start_tournament (DEFINER).
  if not exists (
    select 1 from pg_catalog.pg_proc
     where oid = 'private.match_lifecycle_guard()'::regprocedure
       and prosecdef and 'search_path=""' = any(proconfig)
  ) then
    raise exception 'match_lifecycle_guard: private.match_lifecycle_guard doit être SECURITY DEFINER avec search_path vide';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_proc
     where oid = 'private.tournament_lifecycle_guard()'::regprocedure
       and not prosecdef and 'search_path=""' = any(proconfig)
  ) then
    raise exception 'match_lifecycle_guard: private.tournament_lifecycle_guard doit être SECURITY INVOKER avec search_path vide';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_proc
     where oid = 'private.tournament_insert_lifecycle_guard()'::regprocedure
       and prosecdef and 'search_path=""' = any(proconfig)
  ) then
    raise exception 'match_lifecycle_guard: private.tournament_insert_lifecycle_guard doit être SECURITY DEFINER avec search_path vide';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_proc
     where oid = 'private.start_tournament(uuid, jsonb)'::regprocedure
       and prosecdef and 'search_path=""' = any(proconfig)
       and prosrc like '%incomplete_matches%'
  ) then
    raise exception 'match_lifecycle_guard: private.start_tournament sans contrôle de lot complet ou mal sécurisée';
  end if;

  -- Chemin direct fermé, couche RLS : la RLS reste active et les politiques
  -- restantes sont exactement select, update, delete (ni INSERT, ni ALL).
  if not exists (
    select 1 from pg_catalog.pg_class
     where oid = 'public.tournament_matches'::regclass and relrowsecurity
  ) then
    raise exception 'match_lifecycle_guard: la RLS de tournament_matches n''est plus active';
  end if;
  select string_agg(polcmd::text, '' order by polcmd::text)
    into remaining_policy_commands
    from pg_catalog.pg_policy
   where polrelid = 'public.tournament_matches'::regclass;
  if remaining_policy_commands is distinct from 'drw' then
    raise exception 'match_lifecycle_guard: politiques de tournament_matches inattendues (commandes « % », attendu « drw »)',
      remaining_policy_commands;
  end if;

  -- Couche privilèges : plus d'INSERT pour les rôles applicatifs, et rien
  -- d'autre révoqué — select / update / delete restent au niveau de
  -- public.teams, table sœur jamais restreinte (parité plutôt qu'absolu :
  -- une base locale nue n'a pas les grants par défaut du projet).
  if has_table_privilege('authenticated', 'public.tournament_matches', 'insert')
     or has_table_privilege('anon', 'public.tournament_matches', 'insert') then
    raise exception 'match_lifecycle_guard: le privilège INSERT sur tournament_matches est encore accordé';
  end if;
  foreach role_name in array array['authenticated', 'anon'] loop
    foreach privilege_name in array array['select', 'update', 'delete'] loop
      if has_table_privilege(role_name, 'public.tournament_matches', privilege_name)
         <> has_table_privilege(role_name, 'public.teams', privilege_name) then
        raise exception 'match_lifecycle_guard: privilège % de % sur tournament_matches différent de teams — révocation excessive ?',
          privilege_name, role_name;
      end if;
    end loop;
  end loop;

  -- La RPC reste la voie d'entrée : EXECUTE pour authenticated (enveloppe
  -- publique ET fonction privée, que l'enveloppe INVOKER appelle), pas anon.
  if not has_function_privilege('authenticated', 'public.start_tournament(uuid, jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'private.start_tournament(uuid, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.start_tournament(uuid, jsonb)', 'execute') then
    raise exception 'match_lifecycle_guard: droits de start_tournament inattendus';
  end if;
end $$;
