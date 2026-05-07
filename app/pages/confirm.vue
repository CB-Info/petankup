<script setup lang="ts">
// Page callback du magic link Supabase (flow PKCE).
//
// On surveille `useSupabaseSession()` plutôt que `useSupabaseUser()` parce
// que le module @nuxtjs/supabase a un bug d'égalité (`JSON.stringify` sur
// la session déjà settée) qui empêche d'hydrater `currentUser` dans
// l'onglet du callback. Voir runtime/plugins/supabase.client.js lignes
// 39-60 du module : le plugin set `currentSession` via `getSession()`
// AVANT d'attacher son listener `onAuthStateChange`, dont la garde JSON
// cancel ensuite le `INITIAL_SESSION` du SDK. `useSupabaseSession()` en
// revanche est mis à jour de façon fiable ici. `useSupabaseUser` sera
// hydraté dès la prochaine navigation via le hook `page:start` du module.
//
// Cas erreur : Supabase met l'erreur dans le hash fragment
// (`#error=...&error_description=...`), pas en query — lecture séparée.
//
// Fallback : si l'auto-échange du SDK a échoué (cross-device, code déjà
// consommé), on tente `exchangeCodeForSession` à la main. Sur échec,
// écran d'erreur.
definePageMeta({ layout: false });

const session = useSupabaseSession();
const client = useSupabaseClient();

type PageState = "loading" | "error";
const pageState = ref<PageState>("loading");

// 1. Erreur dans le hash fragment (lien expiré / déjà utilisé).
const hashParams = new URLSearchParams(window.location.hash.slice(1));
const hashError =
  hashParams.get("error_description") ?? hashParams.get("error");
if (hashError) {
  console.warn("[confirm] Supabase auth error in hash:", hashError);
  pageState.value = "error";
}

onMounted(async () => {
  if (pageState.value === "error") return;

  // Si la session est déjà là (auto-échange OK), le watcher redirige.
  if (session.value) return;

  // Sinon, l'auto-échange a échoué : on tente l'échange manuel.
  const code = new URLSearchParams(window.location.search).get("code");
  if (!code) {
    pageState.value = "error";
    return;
  }

  const { error } = await client.auth.exchangeCodeForSession(code);
  if (error && !session.value) {
    console.warn("[confirm] exchangeCodeForSession failed:", error.message);
    pageState.value = "error";
  }
  // Sur succès, le watcher redirige.
});

watch(
  session,
  (currentSession) => {
    if (currentSession) navigateTo("/", { replace: true });
  },
  { immediate: true },
);

useHead({ title: "Connexion en cours — Pétankup" });
</script>

<template>
  <div
    class="flex min-h-screen items-center justify-center bg-default p-4 text-default"
  >
    <p v-if="pageState === 'loading'" class="text-toned">
      Connexion en cours…
    </p>

    <UCard v-else class="w-full max-w-md">
      <template #header>
        <h1 class="text-xl font-semibold text-primary-900">Lien invalide</h1>
      </template>

      <div class="space-y-4">
        <p class="text-sm text-toned">
          Ce lien de connexion a expiré ou a déjà été utilisé. Demande un
          nouveau lien pour te connecter.
        </p>

        <UButton to="/login" color="primary" size="lg" block>
          Recevoir un nouveau lien
        </UButton>
      </div>
    </UCard>
  </div>
</template>
