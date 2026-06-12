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
//
// Layout désactivé : l'écran porte son propre header navy (AppHeader mode
// interne) — le bandeau crème du layout ferait doublon. La déconnexion,
// qui vivait sur l'icône logout de ce bandeau, est rapatriée ici sur le
// bouton « Se déconnecter » (même logique, déclencheur déplacé).
import { ProfileError, type ProfileErrorCode } from "../types";

definePageMeta({ layout: false });

const tournamentStore = useTournamentStore();
const { currentProfile, hasFetchedCurrentProfile } =
  storeToRefs(tournamentStore);
const { showError } = useErrorToast();
const toast = useToast();
const client = useSupabaseClient();
const user = useSupabaseUser();

// Retour vers MON profil public (sens de navigation inversé : on arrive
// ici depuis le profil). Fallback accueil si l'identité n'est pas résolue.
const profileBackTo = computed(() =>
  user.value?.sub ? `/profile/${user.value.sub}` : "/",
);

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

// Déconnexion : logique reprise telle quelle de l'ancien bandeau de
// layout (signOut → /login, erreur en toast).
async function onLogout() {
  try {
    const { error } = await client.auth.signOut();
    if (error) throw new Error(error.message);
    await navigateTo("/login");
  } catch (error) {
    showError(error);
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

// Styles partagés des champs (mêmes valeurs que l'écran Créer un tournoi).
const FIELD_LABEL_CLASS =
  "font-disp text-[10px] font-extrabold tracking-widest uppercase text-(--pk-muted)";
const FIELD_BASE_CLASS =
  "h-12.75 w-full rounded-(--pk-r-md) border-[1.5px] border-(--pk-line) bg-(--pk-card) px-3.5 font-sans text-[15.5px] text-(--pk-ink) placeholder:text-(--pk-muted)";
</script>

<template>
  <div class="min-h-screen bg-default text-default">
    <div class="mx-auto max-w-2xl">
      <AppHeader
        kicker="Compte"
        title="Mon compte"
        :back="{ label: 'Profil', to: profileBackTo }"
      />

      <main class="px-4.5 pt-5.5 pb-10">
        <p
          v-if="!hasFetchedCurrentProfile"
          class="py-16 text-center font-sans text-sm text-(--pk-subtle)"
        >
          Chargement…
        </p>

        <div
          v-else-if="currentProfile === null"
          class="flex flex-col items-center gap-3 py-16 text-center"
        >
          <h2 class="font-disp text-[19px] font-extrabold text-(--pk-ink)">
            Profil indisponible
          </h2>
          <p class="font-sans text-sm text-(--pk-subtle)">
            Vérifiez votre connexion et réessayez.
          </p>
          <UButton
            color="primary"
            block
            :loading="isRetrying"
            class="mt-2 h-13 rounded-[13px] font-disp text-[15px] font-extrabold tracking-[0.02em] uppercase text-(--pk-cream)"
            @click="retryLoadProfile"
          >
            Réessayer
          </UButton>
        </div>

        <template v-else>
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
              :ui="{ label: FIELD_LABEL_CLASS }"
            >
              <UInput
                v-model="state.displayName"
                placeholder="Votre pseudo"
                icon="i-lucide-users"
                variant="none"
                class="w-full"
                :ui="{
                  base: `${FIELD_BASE_CLASS} ps-10.5`,
                  leadingIcon: 'size-4.5 text-(--pk-muted)',
                }"
              />
              <template #help>
                <span class="font-sans text-xs text-(--pk-muted)">
                  Visible par les autres joueurs de vos tournois.
                </span>
              </template>
            </UFormField>

            <UButton
              type="submit"
              color="primary"
              block
              icon="i-lucide-check"
              :loading="isSubmitting"
              :disabled="!canSubmit"
              class="h-13.5 gap-2.25 rounded-[14px] font-disp text-[14.5px] font-extrabold tracking-[0.03em] uppercase text-(--pk-cream) shadow-(--pk-shadow-clay-lg)"
              :ui="{ leadingIcon: 'size-4.5' }"
            >
              Enregistrer
            </UButton>
          </UForm>

          <UButton
            color="primary"
            variant="dashed"
            block
            class="mt-3 h-12.5 rounded-[14px] font-disp text-[13.5px] font-extrabold tracking-[0.04em] uppercase"
            @click="onLogout"
          >
            Se déconnecter
          </UButton>
        </template>
      </main>
    </div>
  </div>
</template>
