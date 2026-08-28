// Amorçage de l'identité pour toute l'application.
//
// Le store identity porte la résolution de l'identité (useSupabaseUser
// d'abord, getClaims en repli) dans un watcher de session. Il doit exister
// AVANT le montage de la première page, quelle qu'elle soit : c'est ce
// plugin qui l'instancie, après le plugin @nuxtjs/supabase (qui a déjà
// hydraté la session) et après Pinia. Aucune page n'a plus à instancier un
// store « pour amorcer l'auth » : chacune tire les données qu'elle affiche,
// gatée sur identity.currentUserId.
//
// Le plugin n'attend rien et ne peut pas lever : le store ne fait aucun
// appel synchrone susceptible de throw (la résolution est asynchrone et
// capture ses erreurs dans lastResolveError).
export default defineNuxtPlugin({
  name: 'identity',
  dependsOn: ['pinia', 'supabase'],
  setup() {
    useIdentityStore()
  },
})
