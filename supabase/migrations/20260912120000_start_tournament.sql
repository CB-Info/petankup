-- ============================================================================
-- 20260912120000_start_tournament
-- Pétankup — démarrer un tournoi en une seule opération (lot DB-1 sur trois).
--
-- Source : la mesure du 2026-09-12 (ticket « la génération des matchs en deux
-- écritures ») et le ticket DB-1.
--
-- Le manque : l'application démarre un tournoi en deux écritures séparées —
-- INSERT des matchs, puis UPDATE du statut en in_progress. Rien ne les lie.
-- Si la seconde échoue (panne entre les deux requêtes, refus), le brouillon
-- est bloqué : les matchs existent mais l'écran, en brouillon, ne les montre
-- pas ; chaque relance heurte l'index unique des paires
-- (tournament_matches_unique_pair_per_tournament — les doublons sont
-- impossibles depuis le schéma initial) avec un message technique. Seule
-- sortie : supprimer le tournoi. Mesure sur l'hébergé : aucun tournoi dans
-- cet état à ce jour.
--
-- Contenu :
--   Bloc 1 : private.start_tournament(p_tournament_id, p_matches) — dans UNE
--            transaction : vérifie (refus typés), passe le tournoi en cours,
--            PUIS insère les matchs. Toute exception annule les deux
--            écritures : tout ou rien.
--   Bloc 2 : enveloppe publique SECURITY INVOKER + droits + commentaire.
--
-- L'ordre des deux écritures compte : le statut d'abord. Le lot DB-2 ajoutera
-- une garde interdisant tout match sur un brouillon ; insérés avant le
-- changement de statut, les matchs seraient refusés par cette garde.
--
-- Le lot de matchs reste GÉNÉRÉ PAR L'APPLICATION (méthode du cercle, ids
-- UUID v4 côté client, manches numérotées — app/utils/tournament.ts, testé).
-- Forme attendue : [{ "id": uuid, "team_a_id": uuid, "team_b_id": uuid,
-- "round_number": int }, …]. La base vérifie ce qu'elle sait vérifier
-- structurellement — équipes de CE tournoi, pas d'équipe contre elle-même,
-- manche ≥ 1, pas de paire ni d'id en double — et ne rejoue pas les règles
-- de génération (aucun contrôle de complétude). Scores, vainqueur et statut
-- ne viennent pas du client : un match démarre en attente, sans score.
--
-- Ce qui ne change pas : le chemin d'écriture direct (INSERT matchs + UPDATE
-- tournoi sous RLS) reste ouvert et intact — l'application déployée
-- continue de fonctionner sans modification. Son retrait est le lot DB-2, à
-- pousser APRÈS le déploiement du lot APP.
--
-- Idempotence : create or replace ; revoke / grant rejouables. Rejouée deux
-- fois sans erreur.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bloc 1 : private.start_tournament
-- ----------------------------------------------------------------------------
-- Même moule que private.create_team_with_players : SECURITY DEFINER (la RLS
-- est contournée, les gardes vivent DANS le corps), refus typés par
-- raise exception 'code' (P0001), not_owner AVANT le gate de statut
-- (anti-fuite de statut aux non-propriétaires, précédent phase_b_4).

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

  -- Garde défensive : des matchs sur un brouillon, c'est l'état bloqué que
  -- ce lot corrige — on ne l'aggrave pas. Le lot DB-2 le rendra impossible.
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

  -- Écriture 1 : le statut d'abord (cf. bannière : la garde du lot DB-2).
  -- updated_at est horodaté par le trigger tournaments_set_updated_at.
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

-- ----------------------------------------------------------------------------
-- Bloc 2 : enveloppe publique
-- ----------------------------------------------------------------------------

create or replace function public.start_tournament(
  p_tournament_id uuid,
  p_matches jsonb
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.start_tournament(p_tournament_id, p_matches);
$$;

revoke all on function public.start_tournament(uuid, jsonb) from public;
revoke all on function public.start_tournament(uuid, jsonb) from anon;
grant execute on function public.start_tournament(uuid, jsonb) to authenticated;

comment on function public.start_tournament(uuid, jsonb) is
  'Starts a draft tournament in a single transaction: moves it to in_progress, then inserts the given matches — generated by the application as [{id, team_a_id, team_b_id, round_number}], stored as pending without scores. Owner only. Raises typed errors: not_authenticated, not_owner, tournament_not_draft, not_enough_teams, matches_already_generated, invalid_matches. Any error rolls back both writes.';
