import { FriendshipError } from "../types";
import type { FriendshipErrorCode, FriendshipRequestOutcome } from "../types";
import {
  friendshipErrorMeansGoalAlreadyMet,
  friendshipErrorMessage,
  friendshipErrorTriggersRefresh,
  parseFriendshipErrorCode,
} from "../utils/friendship-errors";
import type { FriendshipAttemptedAction } from "../utils/friendship-errors";

// La confirmation discrète partagée : « C'est fait. », titre seul, ton
// neutre avec coche — ni l'allure d'alerte du warning, ni le vert de
// célébration. Sert DEUX situations : le succès de toute SUPPRESSION
// (refuser, annuler, retirer — la famille friendshipActionIsDeletion), et
// une suppression dont l'objectif était déjà atteint — « C'est fait » est
// vrai dans les deux.
export const QUIET_CONFIRMATION_TOAST = {
  title: "C'est fait.",
  color: "neutral",
  icon: "i-lucide-check",
} as const;

// Les annonces des CRÉATIONS : elles nomment ce qui vient d'exister, en
// vert de succès — jamais le « C'est fait » des suppressions.
// FRIENDSHIP_ESTABLISHED sert les deux routes vers une amitié (demande
// croisée acceptée d'office, acceptation explicite) : un seul message.
export const FRIENDSHIP_ESTABLISHED_TOAST = {
  title: "Vous êtes maintenant amis.",
  color: "success",
  icon: "i-lucide-check",
} as const;

export const REQUEST_SENT_TOAST = {
  title: "Demande envoyée.",
  color: "success",
  icon: "i-lucide-check",
} as const;

// Retours utilisateur des actions d'amitié, communs à l'écran des amis et à
// la page de profil.
//
// INVARIANT : aucune action d'amitié ne reste muette. Ce qui disparaît
// confirme (« C'est fait. », neutre) ; ce qui apparaît nomme (« Demande
// envoyée. », « Vous êtes maintenant amis. », succès).
//
// RÈGLE : on n'appelle JAMAIS showError avec un code d'amitié — le message
// brut d'une FriendshipError EST le code (« not_addressee ») et le message
// d'une Error issue d'une RPC d'amitié peut l'être aussi
// (find_account_by_display_name lève not_authenticated en Error nue).
// Chaque erreur passe donc par le décodeur : code connu → toast traduit
// (+ rafraîchissement des listes si l'état local est trahi périmé) ;
// code inconnu → showError (vraie panne, message générique).
export function useFriendshipFeedback() {
  const toast = useToast();
  const { showError } = useErrorToast();
  const friendshipStore = useFriendshipStore();

  function decodeFriendshipErrorCode(error: unknown): FriendshipErrorCode {
    if (error instanceof FriendshipError) return error.code;
    if (error instanceof Error) return parseFriendshipErrorCode(error.message);
    return "unknown";
  }

  // Affiche l'erreur d'une action d'amitié. L'appelant déclare le geste
  // tenté : la traduction dépend de l'action, pas seulement du code — une
  // suppression dont la cible a déjà disparu est un objectif atteint, pas
  // un échec. Retourne le code décodé pour que l'appelant puisse, s'il a
  // un champ concerné (la recherche de l'écran des amis), préférer un
  // affichage inline au toast.
  function showFriendshipError(
    error: unknown,
    attemptedAction: FriendshipAttemptedAction,
  ): FriendshipErrorCode {
    const code = decodeFriendshipErrorCode(error);

    // Objectif déjà atteint (annuler/refuser une demande qui n'existe
    // plus) : confirmation discrète — ton neutre avec coche, ni l'allure
    // d'alerte du warning ni le vert de célébration — et recalage des
    // listes sur l'état réel.
    if (friendshipErrorMeansGoalAlreadyMet(attemptedAction, code)) {
      toast.add(QUIET_CONFIRMATION_TOAST);
      void friendshipStore.refreshFriendships();
      return code;
    }
    if (code === "unknown") {
      // Une FriendshipError('unknown') porte « unknown » comme message
      // (super(code)) : showError l'afficherait tel quel. On sert le
      // message générique traduit ; une Error étrangère au domaine garde le
      // circuit showError standard (son message réel est plus utile).
      if (error instanceof FriendshipError) {
        toast.add({
          title: friendshipErrorMessage(code),
          color: "error",
          icon: "i-lucide-alert-triangle",
        });
        return code;
      }
      showError(error);
      return code;
    }
    toast.add({
      title: friendshipErrorMessage(code),
      color: "warning",
      icon: "i-lucide-info",
    });
    if (friendshipErrorTriggersRefresh(code)) {
      void friendshipStore.refreshFriendships();
    }
    return code;
  }

  // Une amitié existe désormais — quelle que soit la route qui y a mené
  // (acceptation explicite, ou demande croisée acceptée d'office).
  function showFriendshipEstablished(): void {
    toast.add(FRIENDSHIP_ESTABLISHED_TOAST);
  }

  // L'issue d'une demande, dite honnêtement : des demandes croisées rendent
  // amis immédiatement — l'écran le dit, il ne prétend pas qu'une demande
  // est partie (A7).
  function showRequestOutcome(outcome: FriendshipRequestOutcome): void {
    if (outcome === "accepted") {
      showFriendshipEstablished();
      return;
    }
    toast.add(REQUEST_SENT_TOAST);
  }

  // Accusé de réception du succès d'une SUPPRESSION (refuser, annuler,
  // retirer) : un succès silencieux ressemblerait à un raté. Même
  // confirmation discrète que les suppressions à objectif déjà atteint ;
  // c'est un SUCCÈS d'action, il ne relève pas de la règle sur les erreurs.
  function showQuietConfirmation(): void {
    toast.add(QUIET_CONFIRMATION_TOAST);
  }

  return {
    decodeFriendshipErrorCode,
    showFriendshipError,
    showFriendshipEstablished,
    showRequestOutcome,
    showQuietConfirmation,
  };
}
