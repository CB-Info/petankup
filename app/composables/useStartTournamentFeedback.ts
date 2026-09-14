import { StartTournamentError } from "../types";
import { startTournamentErrorMessage } from "../utils/start-tournament-errors";

// Retour utilisateur d'un refus de démarrage de tournoi (RPC
// start_tournament), pour la page du tournoi.
//
// RÈGLE : une StartTournamentError ne passe JAMAIS par showError — son
// message brut est un code (« tournament_not_draft »). Code connu → toast
// d'avertissement traduit ; code inconnu (réseau, panne) → toast d'erreur au
// message générique, jamais « unknown » tel quel. Recharger ou non l'écran
// reste la décision de la page (startTournamentErrorMeansStaleScreen).
export function useStartTournamentFeedback() {
  const toast = useToast();

  // true si l'erreur était un refus de démarrage — annoncé ici ; false
  // sinon — l'appelant passe par showError (erreur étrangère au domaine).
  function announceStartRefusal(error: unknown): error is StartTournamentError {
    if (!(error instanceof StartTournamentError)) return false;
    const isUnexpectedFailure = error.code === "unknown";
    toast.add({
      title: startTournamentErrorMessage(error.code),
      color: isUnexpectedFailure ? "error" : "warning",
      icon: isUnexpectedFailure ? "i-lucide-alert-triangle" : "i-lucide-info",
    });
    return true;
  }

  return { announceStartRefusal };
}
