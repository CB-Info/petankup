<script setup lang="ts">
// Écran "Mon compte" : affichage et édition du pseudo (display_name).
//
// Pattern d'erreurs : updateMyProfile (store) throw ; on attrape ici et
// on affiche un toast via useErrorToast. En succès, un toast de
// confirmation (couleur success, cohérente avec le badge "Terminé").
//
// Chargement du profil : on N'appelle PAS loadCurrentProfile() au mount.
// L'action early-return si l'identité n'est pas encore résolue (fenêtre
// refresh / magic link) AVANT de passer hasFetchedCurrentProfile à true —
// la page resterait alors coincée sur "Chargement…". Le chargement
// initial est garanti par l'orchestration d'auth du store
// (loadTournamentsForCurrentSession → void loadCurrentProfile()), qui
// tourne sur n'importe quel point d'entrée, /account compris. La page se
// contente d'observer hasFetchedCurrentProfile / currentProfile. Le seul
// loadCurrentProfile() déclenché ici est le bouton "Réessayer" de l'état
// d'erreur — sûr, car atteindre cet état implique l'identité résolue.
//
// Conflit d'unicité du pseudo : updateMyProfile peut throw une
// ProfileError('display_name_taken') (mappée depuis le 23505 Postgres par
// le repo). On l'affiche inline sous le champ, pas en toast, pour laisser
// l'utilisateur corriger sans recharger. Même pattern que les codes
// d'erreur typés des invitations (InviteMemberError).
import { ProfileError, type ProfileErrorCode } from "../types";

const tournamentStore = useTournamentStore();
const { currentProfile, hasFetchedCurrentProfile } =
  storeToRefs(tournamentStore);
const { showError } = useErrorToast();
const toast = useToast();

const state = reactive({ displayName: "" });

// Le profil peut arriver après le mount (chargement async piloté par le
// store). On (re)synchronise l'input dès qu'il est disponible ou mis à
// jour — couvre aussi la resynchro après un updateMyProfile réussi.
watch(
  currentProfile,
  (profile) => {
    if (profile) state.displayName = profile.displayName;
  },
  { immediate: true },
);

// UForm valide sur la valeur trimmée (cf. profileSchema.trim()), donc on
// lui passe un état trimmé tout en bindant l'input sur l'état brut.
const trimmedFormState = computed(() => ({
  displayName: state.displayName.trim(),
}));

const isSubmitting = ref(false);

// Erreur serveur affichée inline sous le champ (conflit d'unicité). Reset
// à chaque soumission pour ne pas garder une erreur déjà corrigée.
const displayNameError = ref<string | null>(null);

// Switch exhaustif sans default : TypeScript signalera tout code ajouté à
// ProfileErrorCode qui ne serait pas mappé ici (miroir de
// inviteErrorMessage dans TournamentMembersModal).
function profileErrorMessage(code: ProfileErrorCode): string {
  switch (code) {
    case "display_name_taken":
      return "Ce pseudo est déjà utilisé. Choisissez-en un autre.";
  }
}

// Rien à enregistrer si le pseudo est vide après trim, ou identique au
// pseudo courant — on désactive le submit dans ces cas.
const canSubmit = computed(() => {
  const trimmed = state.displayName.trim();
  if (trimmed.length === 0) return false;
  if (trimmed === currentProfile.value?.displayName) return false;
  return true;
});

async function onSubmit() {
  if (isSubmitting.value || !canSubmit.value) return;
  isSubmitting.value = true;
  displayNameError.value = null;
  try {
    await tournamentStore.updateMyProfile(state.displayName.trim());
    toast.add({
      title: "Pseudo mis à jour",
      color: "success",
      icon: "i-lucide-check",
    });
  } catch (error) {
    if (error instanceof ProfileError) {
      displayNameError.value = profileErrorMessage(error.code);
      return;
    }
    showError(error);
  } finally {
    isSubmitting.value = false;
  }
}

const isRetrying = ref(false);

async function retryLoadProfile() {
  if (isRetrying.value) return;
  isRetrying.value = true;
  try {
    await tournamentStore.loadCurrentProfile();
  } finally {
    isRetrying.value = false;
  }
}

useHead({ title: "Mon compte — Pétankup" });
</script>

<template>
  <div class="space-y-4">
    <UButton to="/" variant="ghost" color="neutral" size="sm">
      ← Retour à l'accueil
    </UButton>

    <div v-if="!hasFetchedCurrentProfile" class="py-16 text-center">
      <p class="text-toned">Chargement…</p>
    </div>

    <div
      v-else-if="currentProfile === null"
      class="space-y-3 py-16 text-center"
    >
      <h1 class="text-lg font-semibold text-primary-900">
        Profil indisponible
      </h1>
      <p class="text-toned">Vérifiez votre connexion et réessayez.</p>
      <UButton
        color="primary"
        size="lg"
        :loading="isRetrying"
        class="mt-2"
        block
        @click="retryLoadProfile"
      >
        Réessayer
      </UButton>
    </div>

    <UCard v-else>
      <template #header>
        <h1 class="text-xl font-semibold text-primary-900">Mon compte</h1>
      </template>

      <UForm
        :schema="profileSchema"
        :state="trimmedFormState"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField
          label="Pseudo"
          name="displayName"
          :error="displayNameError ?? undefined"
          required
        >
          <UInput
            v-model="state.displayName"
            placeholder="Votre pseudo"
            class="w-full"
          />
        </UFormField>

        <UButton
          type="submit"
          color="primary"
          size="lg"
          :loading="isSubmitting"
          :disabled="!canSubmit"
          block
        >
          Enregistrer
        </UButton>
      </UForm>
    </UCard>
  </div>
</template>
