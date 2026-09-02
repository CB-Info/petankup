import { FriendshipError } from "../types";
import type { FriendshipErrorCode, FriendshipRequestOutcome } from "../types";
import {
  friendshipErrorMessage,
  friendshipErrorTriggersRefresh,
  parseFriendshipErrorCode,
} from "../utils/friendship-errors";

// Retours utilisateur des actions d'amitié, communs à l'écran des amis et à
// la page de profil.
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

  // Affiche l'erreur d'une action d'amitié. Retourne le code décodé pour
  // que l'appelant puisse, s'il a un champ concerné (la recherche de
  // l'écran des amis), préférer un affichage inline au toast.
  function showFriendshipError(error: unknown): FriendshipErrorCode {
    const code = decodeFriendshipErrorCode(error);
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

  // L'issue d'une demande, dite honnêtement : des demandes croisées rendent
  // amis immédiatement — l'écran le dit, il ne prétend pas qu'une demande
  // est partie (A7).
  function showRequestOutcome(outcome: FriendshipRequestOutcome): void {
    toast.add({
      title:
        outcome === "accepted"
          ? "Vous êtes maintenant amis."
          : "Demande envoyée.",
      color: "success",
      icon: "i-lucide-check",
    });
  }

  return { decodeFriendshipErrorCode, showFriendshipError, showRequestOutcome };
}
