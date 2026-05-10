// Helper UI pour afficher les erreurs jetées par le store ou les API
// externes (Supabase auth, etc.) sous forme de toast.
//
// Pattern d'erreurs adopté pour le projet :
//   - Les actions du store throw (pas de catch interne).
//   - Les composants/handlers attrapent et appellent showError(error).
//   - Garde la séparation des responsabilités sans dupliquer le code
//     de toast à chaque catch.

export function useErrorToast() {
  const toast = useToast()

  function showError(error: unknown): void {
    const description = error instanceof Error
      ? error.message
      : 'Erreur inconnue'
    toast.add({
      title: 'Une erreur est survenue',
      description,
      color: 'error',
      icon: 'i-lucide-alert-triangle',
    })
  }

  return { showError }
}
