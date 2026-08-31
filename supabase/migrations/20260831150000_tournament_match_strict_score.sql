-- ============================================================================
-- 20260831150000_tournament_match_strict_score
-- Pétankup — fix(db) : durcir la règle de score des matchs de tournoi.
--
-- Le défaut : tournament_matches_completed_score_valid (posée en
-- 20260506214404, renommée en 20260827120000) n'exige que
-- greatest(score_a, score_b) >= 13 — un 20-0 passe. Règle corrigée, alignée
-- sur les matchs libres (20260828100000) : le vainqueur marque EXACTEMENT 13,
-- le perdant entre 0 et 12 (on joue toujours en 13). La non-égalité en
-- découle (13 ≠ 0..12) — la clause <> de la contrainte historique devient
-- redondante mais reste en place (voir décisions).
--
-- Contenu :
--   Bloc 1 : deux CHECK additives, miroirs de free_matches_winner_scores_13
--            et free_matches_loser_between_0_and_12, gardées par le statut
--            (un match pending a ses scores NULL — contrainte
--            tournament_matches_pending_no_score ; la garde est là pour la
--            lisibilité, les CHECK passeraient déjà sur NULL).
--   Bloc 2 : assertions finales (contraintes présentes ET validées).
--
-- Décisions actées :
--   - ADDITIF STRICT : la contrainte historique
--     tournament_matches_completed_score_valid reste en place, intacte.
--     Ses clauses >= 0, >= 13 et <> deviennent redondantes (impliquées par
--     les nouvelles CHECK) mais elle garde l'exclusivité de la cohérence
--     winner_id ↔ scores et du non-NULL. La retailler serait un diff plus
--     risqué pour un gain nul.
--   - Périmètre DB seul : validateScore() côté app reste laxiste (>= 13) —
--     ticket suivant (remontée de la règle dans le composant de saisie
--     partagé). Entre les deux, une saisie 15-12 via l'UI recevra un 23514
--     brut — dette connue, tracée dans la roadmap.
--   - AUCUN backfill ici : le ADD CONSTRAINT valide les lignes existantes et
--     échoue BRUYAMMENT sur une base contenant des scores fautifs —
--     comportement voulu. Les données de l'environnement hébergé (4 matchs,
--     vainqueur à 14/15/20 contre 0) sont corrigées par une opération
--     one-off AVANT le push, via la réouverture sanctionnée
--     (completed → in_progress → correction → re-complétion, stats
--     re-matérialisées par les triggers du gel).
--
-- Invariants à ne PAS casser :
--   - Postgres évalue les CHECK en ordre ALPHABÉTIQUE de nom : en violation
--     multiple, la contrainte historique (c… < l… < w…) est citée en
--     premier. Le harnais tournament_score_check.sql asserte les messages
--     exacts — RENOMMER l'une des CHECK de tournament_matches changerait la
--     contrainte citée et casserait le harnais.
--   - status est NOT NULL, enum match_status à deux valeurs (pending,
--     completed) : status <> 'completed' ≡ pending.
--   - Idempotent via DO/duplicate_object (précédent phase_i, Bloc 1.4) ;
--     rejouable indéfiniment, le Bloc 2 revérifie le catalogue à chaque
--     passage.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bloc 1 : les deux CHECK. Une assertion par contrainte pour qu'un 23514
-- cite la règle violée (précédent free_match_schema, Bloc 2).
-- ----------------------------------------------------------------------------

do $$
begin
  alter table public.tournament_matches
    add constraint tournament_matches_winner_scores_13
    check (
      status <> 'completed'
      or greatest(score_a, score_b) = 13
    );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.tournament_matches
    add constraint tournament_matches_loser_between_0_and_12
    check (
      status <> 'completed'
      or least(score_a, score_b) between 0 and 12
    );
exception
  when duplicate_object then null;
end $$;

-- ----------------------------------------------------------------------------
-- Bloc 2 : assertions finales — les deux contraintes existent et sont
-- VALIDÉES (convalidated : aucune ligne existante ne viole la règle).
-- ----------------------------------------------------------------------------

do $$
declare
  missing_names text;
begin
  select string_agg(expected.conname, ', ' order by expected.conname)
    into missing_names
    from (values
      ('tournament_matches_winner_scores_13'),
      ('tournament_matches_loser_between_0_and_12')
    ) as expected(conname)
   where not exists (
     select 1
       from pg_catalog.pg_constraint existing
      where existing.conrelid = 'public.tournament_matches'::regclass
        and existing.contype = 'c'
        and existing.conname = expected.conname
        and existing.convalidated
   );

  if missing_names is not null then
    raise exception 'tournament_match_strict_score: contraintes absentes ou non validées : %',
      missing_names;
  end if;
end $$;
