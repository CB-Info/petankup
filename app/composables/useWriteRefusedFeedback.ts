import { WriteRefusedError } from "../types";
import { writeRefusedFeedback } from "../utils/write-refused";

// Retour utilisateur d'une écriture refusée sur zéro ligne, commun aux
// écrans qui écrivent en direct (tournoi, match libre, compte).
//
// RÈGLE : une WriteRefusedError ne passe JAMAIS par showError — son message
// brut est un code (« update_refused »). L'écran l'annonce ici, en
// avertissement, puis recharge l'objet affiché avec ses propres primitives :
// le message ne dit pas pourquoi, le rechargement le montre.
export function useWriteRefusedFeedback() {
  const toast = useToast();

  // true si l'erreur était un refus — annoncé ici, l'appelant recharge ;
  // false sinon — l'appelant passe par showError (vraie panne).
  function announceWriteRefusal(error: unknown): error is WriteRefusedError {
    if (!(error instanceof WriteRefusedError)) return false;
    const feedback = writeRefusedFeedback(error.code);
    toast.add({
      title: feedback.title,
      description: feedback.description,
      color: "warning",
      icon: "i-lucide-alert-triangle",
    });
    return true;
  }

  return { announceWriteRefusal };
}
