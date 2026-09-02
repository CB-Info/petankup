-- ============================================================================
-- 20260902150000_cancel_friendship_outcomes
-- Pétankup — distinguer les causes d'échec de l'annulation d'une demande.
--
-- Le manque : private.cancel_friendship_request (A1, 20260901180000) lève
-- request_not_found dès que la ligne du duo n'est pas 'pending' — que la
-- demande ait été refusée (ligne supprimée) ou ACCEPTÉE entre-temps (ligne
-- 'accepted'). Le second cas est trompeur : l'utilisateur croit avoir
-- annulé alors qu'il vient de gagner un ami, qu'il doit pouvoir retirer.
--
-- Contenu :
--   Bloc 1 : private.cancel_friendship_request redéfinie — la garde
--            « is distinct from 'pending' » est SCINDÉE en trois issues.
--            Signature inchangée (returns void) : le wrapper public, les
--            grants et database.types.ts ne bougent pas.
--   Bloc 2 : grants réénoncés + comment on function du wrapper réécrit.
--   Bloc 3 : assertions finales.
--
-- Décisions actées :
--   - Un CODE d'erreur, pas un retour d'état : une seule issue est un
--     succès (la demande est annulée) — le retour d'état est réservé aux
--     actions dont plusieurs issues sont des réussites (request_friendship).
--     Un changement de type de retour exigerait de surcroît un DROP
--     FUNCTION (recréation wrapper + grants) et rendrait les types générés
--     menteurs sans gen:types.
--   - Le code de l'issue « devenue amitié » est already_friends,
--     RÉUTILISÉ : déjà levé par request_friendship pour la même vérité,
--     déjà traduit côté app (« Vous êtes déjà amis avec ce joueur. ») et
--     déjà déclencheur d'un rafraîchissement des listes — l'ami apparaît
--     avec son bouton « Retirer » sans aucune modification applicative.
--   - « Plus rien » reste request_not_found, INDISTINCT par décision : un
--     refus, une annulation par un autre chemin et une disparition de
--     compte donnent le même code — qui est AUSSI celui d'une demande
--     jamais envoyée. On ne révèle jamais qui a refusé.
--   - Les 5 autres RPC d'amitié ne changent pas (accept/refuse gardent
--     request_not_found pour une relation déjà acceptée : leur appelant
--     est le DESTINATAIRE, qui a lui-même accepté — le cas trompeur
--     n'existe que pour le demandeur qui annule).
--   - On n'édite JAMAIS une migration appliquée : 20260901180000 reste
--     telle quelle, cette migration porte la version courante.
--
-- Rappels : idempotente (create or replace, grants rejouables) ;
-- search_path = '' ; aucun fichier applicatif ; gen:types inutile
-- (signature inchangée).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bloc 1 : la garde scindée. Corps repris de 20260901180000 (Bloc 4.4),
-- seule la première garde change de forme.
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

  -- Plus rien : refus, annulation par un autre chemin, ou disparition du
  -- compte — INDISTINCTS par décision (ne jamais révéler qui a refusé, ni
  -- distinguer d'une demande jamais envoyée).
  if v_status is null then
    raise exception 'request_not_found';
  end if;

  -- La demande a été acceptée entre-temps : l'appelant doit savoir qu'il a
  -- maintenant un ami (à retirer le cas échéant), pas croire qu'il a
  -- annulé. Code existant (request_friendship), déjà traduit et déjà
  -- déclencheur de rafraîchissement côté app.
  if v_status = 'accepted' then
    raise exception 'already_friends';
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

-- ----------------------------------------------------------------------------
-- Bloc 2 : grants réénoncés (préservés par le create or replace, réaffirmés
-- pour rester explicites) + commentaire du wrapper public réécrit (le
-- wrapper lui-même, INVOKER de A1, est inchangé).
-- ----------------------------------------------------------------------------

revoke all on function private.cancel_friendship_request(uuid) from public;
grant execute on function private.cancel_friendship_request(uuid) to authenticated;

comment on function public.cancel_friendship_request(uuid) is
  'Cancels the caller''s own pending friend request to the given user, by '
  'DELETING the row: no trace kept, requesting again works. Requester only. '
  'Three outcomes: success (cancelled); request_not_found when there is '
  'nothing left — refused, cancelled elsewhere or account gone stay '
  'deliberately indistinct from a request never sent (never reveal who '
  'refused); already_friends when the request was accepted in the meantime — '
  'the caller now has a friend to remove, not a cancelled request. Raises '
  'typed errors: not_authenticated, request_not_found, already_friends, '
  'not_requester.';

-- ----------------------------------------------------------------------------
-- Bloc 3 : assertions finales — toute anomalie annule la migration.
-- ----------------------------------------------------------------------------

do $$
declare
  cancel_function_is_current boolean;
  wrapper_is_invoker boolean;
  friendship_rpc_count integer;
  authenticated_can_execute boolean;
  anon_can_execute boolean;
begin
  -- La garde scindée est en place ET les gardes historiques sont conservées.
  select p.prosecdef
         and 'search_path=""' = any(p.proconfig)
         and p.prosrc like '%already_friends%'
         and p.prosrc like '%request_not_found%'
         and p.prosrc like '%not_requester%'
         and p.prosrc like '%not_authenticated%'
    into cancel_function_is_current
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and p.proname = 'cancel_friendship_request';

  select not p.prosecdef
    into wrapper_is_invoker
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'cancel_friendship_request';

  -- Les 5 autres RPC d'amitié sont toujours là (aucune n'a été touchée).
  select count(*)
    into friendship_rpc_count
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and p.proname in ('request_friendship', 'accept_friendship',
                       'refuse_friendship', 'cancel_friendship_request',
                       'remove_friendship', 'get_friendships');

  select has_function_privilege('authenticated',
           'public.cancel_friendship_request(uuid)', 'EXECUTE')
    into authenticated_can_execute;
  select has_function_privilege('anon',
           'public.cancel_friendship_request(uuid)', 'EXECUTE')
    into anon_can_execute;

  if cancel_function_is_current is distinct from true then
    raise exception 'cancel_friendship_outcomes: la fonction ne porte pas la garde scindée (ou a perdu une garde historique)';
  end if;
  if wrapper_is_invoker is distinct from true then
    raise exception 'cancel_friendship_outcomes: le wrapper public doit rester INVOKER';
  end if;
  if friendship_rpc_count <> 6 then
    raise exception 'cancel_friendship_outcomes: les 6 RPC d''amitié doivent exister (obtenu %)', friendship_rpc_count;
  end if;
  if not authenticated_can_execute then
    raise exception 'cancel_friendship_outcomes: authenticated doit pouvoir exécuter le wrapper';
  end if;
  if anon_can_execute then
    raise exception 'cancel_friendship_outcomes: anon ne doit pas pouvoir exécuter le wrapper';
  end if;
end;
$$;
