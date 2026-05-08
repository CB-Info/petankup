<script setup lang="ts">
// Pattern d'erreurs : signInWithOtp peut échouer (réseau, email invalide
// côté Supabase, rate limit). On attrape ici et on affiche un toast via
// useErrorToast. Voir app/composables/useErrorToast.ts.
import { z } from "zod";

definePageMeta({ layout: false });

const client = useSupabaseClient();
// On observe la session plutôt que useSupabaseUser pour la même raison
// que dans le layout : le ref user n'est pas hydraté au premier mount
// (refresh sur /login avec session valide en localStorage) à cause d'un
// bug du hook page:start du module @nuxtjs/supabase. La session est en
// revanche peuplée de façon déterministe par le plugin du module.
const session = useSupabaseSession();
const { showError } = useErrorToast();

const loginSchema = z.object({
  email: z.string().email("Adresse email invalide"),
});

const state = reactive({ email: "" });
const isSubmitting = ref(false);
const linkSent = ref(false);

// Si l'utilisateur est déjà authentifié (ex : il revient sur /login après
// connexion), redirection automatique vers la home.
watch(
  session,
  (currentSession) => {
    if (currentSession) navigateTo("/");
  },
  { immediate: true },
);

async function onSubmit() {
  if (isSubmitting.value) return;
  isSubmitting.value = true;
  try {
    const { error } = await client.auth.signInWithOtp({
      email: state.email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/confirm`,
      },
    });
    if (error) throw new Error(error.message);
    linkSent.value = true;
  } catch (error) {
    showError(error);
  } finally {
    isSubmitting.value = false;
  }
}

async function onGoogleLogin() {
  if (isSubmitting.value) return;
  isSubmitting.value = true;
  try {
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/confirm`,
        queryParams: {
          prompt: "select_account",
        },
      },
    });
    if (error) throw new Error(error.message);
    // Pas de finally ici : signInWithOAuth redirige immédiatement la
    // fenêtre vers Google en cas de succès, on ne revient pas dans ce
    // callback. On ne reset isSubmitting que dans la branche d'erreur
    // synchrone (réseau coupé, config Supabase invalide, etc.).
  } catch (error) {
    showError(error);
    isSubmitting.value = false;
  }
}

useHead({ title: "Connexion — Pétankup" });
</script>

<template>
  <div
    class="flex min-h-screen items-center justify-center bg-default p-4 text-default"
  >
    <UCard class="w-full max-w-md">
      <template #header>
        <h1 class="text-xl font-semibold text-primary-900">Pétankup</h1>
        <p class="mt-1 text-sm text-toned">
          Connecte-toi pour gérer tes tournois entre amis.
        </p>
      </template>

      <div v-if="!linkSent">
        <UButton
          variant="outline"
          color="neutral"
          size="lg"
          :loading="isSubmitting"
          block
          @click="onGoogleLogin"
        >
          Continuer avec Google
        </UButton>

        <div class="my-4 flex items-center gap-3">
          <div class="h-px flex-1 bg-default" />
          <span class="text-xs uppercase tracking-wider text-toned">ou</span>
          <div class="h-px flex-1 bg-default" />
        </div>
      </div>

      <div v-if="linkSent" class="space-y-3 text-center">
        <UIcon
          name="i-lucide-mail-check"
          class="mx-auto size-10 text-primary-500"
        />
        <h2 class="text-base font-semibold text-primary-900">
          Vérifie ta boîte mail
        </h2>
        <p class="text-sm text-toned">
          Un lien de connexion a été envoyé à
          <span class="font-medium text-primary-900">{{ state.email }}</span
          >. Le lien expire après quelques minutes.
        </p>
      </div>

      <UForm
        v-else
        :schema="loginSchema"
        :state="state"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField label="Email" name="email" required>
          <UInput
            v-model="state.email"
            type="email"
            autocomplete="email"
            placeholder="ton.email@exemple.com"
            class="w-full"
          />
        </UFormField>

        <UButton
          type="submit"
          color="primary"
          size="lg"
          :loading="isSubmitting"
          block
        >
          Recevoir le lien magique
        </UButton>
      </UForm>
    </UCard>
  </div>
</template>
