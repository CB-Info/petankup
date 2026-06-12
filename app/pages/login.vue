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
    class="flex min-h-screen items-center justify-center px-5 py-10 [background:var(--pk-grad-login)]"
  >
    <div class="w-full max-w-84.5 text-center">
      <template v-if="!linkSent">
        <div class="flex justify-center">
          <BouleAvatar tone="gold" :size="68" />
        </div>

        <h1
          class="mt-3.5 font-disp text-[26px] font-extrabold tracking-[0.02em] uppercase text-(--pk-cream)"
        >
          Pétankup
        </h1>
        <p class="mt-1.5 font-sans text-[13.5px] text-(--pk-on-navy-2)">
          Vos tournois entre amis, sans prise de tête.
        </p>

        <UButton
          color="cream"
          block
          :loading="isSubmitting"
          class="mt-7 h-13.5 gap-2.75 rounded-[14px] font-sans text-[15.5px] font-bold shadow-[0_18px_34px_-16px_rgb(0_0_0/0.5)]"
          @click="onGoogleLogin"
        >
          <GoogleLogo class="h-4.5 w-auto shrink-0" />
          Continuer avec Google
        </UButton>

        <div class="my-4.5 flex items-center gap-3.5">
          <div class="h-px flex-1 bg-white/12" />
          <span
            class="font-disp text-[11px] font-extrabold tracking-[0.14em] text-(--pk-on-navy-2)"
          >
            OU
          </span>
          <div class="h-px flex-1 bg-white/12" />
        </div>

        <UForm
          :schema="loginSchema"
          :state="state"
          class="space-y-4 text-left"
          @submit="onSubmit"
        >
          <UFormField
            label="Email"
            name="email"
            required
            :ui="{
              label:
                'font-disp text-[11px] font-extrabold tracking-[0.1em] uppercase text-(--pk-on-navy-3)',
            }"
          >
            <UInput
              v-model="state.email"
              type="email"
              autocomplete="email"
              placeholder="ton.email@exemple.com"
              variant="none"
              class="w-full"
              :ui="{
                base: 'h-13 w-full rounded-[13px] border-[1.5px] border-white/14 bg-white/6 px-4 font-sans text-[15.5px] text-(--pk-cream) placeholder:text-(--pk-on-navy-3)',
              }"
            />
          </UFormField>

          <UButton
            type="submit"
            color="primary"
            block
            :loading="isSubmitting"
            icon="i-lucide-arrow-right"
            class="h-13.5 gap-2.25 rounded-[14px] font-disp text-[14.5px] font-extrabold tracking-[0.03em] uppercase text-(--pk-cream) shadow-(--pk-shadow-clay-lg)"
            :ui="{ leadingIcon: 'size-4.5' }"
          >
            Recevoir le lien magique
          </UButton>
        </UForm>

        <p class="mt-5.5 font-sans text-xs leading-[1.6] text-(--pk-on-navy-3)">
          En continuant, vous acceptez nos conditions. Aucune publicité,
          aucune revente de données.
        </p>
      </template>

      <div v-else class="space-y-3">
        <UIcon name="i-lucide-mail-check" class="mx-auto size-10 text-secondary" />
        <h2 class="font-disp text-[19px] font-extrabold text-(--pk-cream)">
          Vérifie ta boîte mail
        </h2>
        <p class="font-sans text-sm text-(--pk-on-navy-2)">
          Un lien de connexion a été envoyé à
          <span class="font-bold text-(--pk-cream)">{{ state.email }}</span
          >. Le lien expire après quelques minutes.
        </p>
      </div>
    </div>
  </div>
</template>
