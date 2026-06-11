<script setup lang="ts">
// Layout shell : header sticky + zone de contenu centrée mobile-first.
// Couleurs neutres servies par les utilitaires sémantiques Nuxt UI
// (thème « Nuit & Corail », mode clair uniquement — pas de bascule dark).
//
// Pattern d'erreurs : signOut peut échouer (réseau). On attrape ici et
// on affiche un toast via useErrorToast (voir composables/useErrorToast).
//
// Pourquoi `useSupabaseSession()` et non `useSupabaseUser()` pour gater
// le bouton logout : le ref user n'est pas fiable au premier mount du
// layout après auth via magic link. Le module @nuxtjs/supabase hydrate
// `useSupabaseUser` via son hook `page:start`, qui ne fire pas pour la
// transition initiale issue de `navigateTo()` depuis confirm.vue —
// résultat : le bouton resterait invisible jusqu'à la première
// navigation interne. La session, elle, est mise à jour de façon
// déterministe par le plugin du module via `getSession()` au boot.
//
// Note : `session.value.user` est un User Supabase standard (champs
// `id`, `email`, ...), à ne pas confondre avec `useSupabaseUser()`
// qui expose un JwtPayload (champ `sub` pour l'ID). Le store applicatif
// lit `sub` via useSupabaseUser car il tourne dans un contexte navigué
// où le ref est déjà hydraté — la distinction est importante pour ne
// pas refaire l'erreur du Ticket 4 suite 3.

const client = useSupabaseClient();
const session = useSupabaseSession();
const { showError } = useErrorToast();

async function onLogout() {
  try {
    const { error } = await client.auth.signOut();
    if (error) throw new Error(error.message);
    await navigateTo("/login");
  } catch (error) {
    showError(error);
  }
}
</script>

<template>
  <div class="min-h-screen bg-default text-default">
    <header class="sticky top-0 z-10 border-b border-default bg-elevated">
      <div
        class="mx-auto flex min-h-14 max-w-2xl items-center justify-between gap-2 px-4 py-3"
      >
        <NuxtLink to="/" class="text-lg font-semibold text-primary-900">
          Pétankup
        </NuxtLink>
        <div class="flex items-center gap-1">
          <UButton
            v-if="session"
            to="/account"
            icon="i-lucide-user"
            variant="ghost"
            color="neutral"
            aria-label="Mon compte"
          />
          <UButton
            v-if="session"
            icon="i-lucide-log-out"
            variant="ghost"
            color="neutral"
            aria-label="Se déconnecter"
            @click="onLogout"
          />
        </div>
      </div>
    </header>

    <main class="mx-auto max-w-2xl p-4">
      <slot />
    </main>
  </div>
</template>
