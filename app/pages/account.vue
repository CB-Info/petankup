<script setup lang="ts">
// Écran "Mon compte" : affichage et édition du pseudo (display_name).
//
// Pattern d'erreurs : updateMyProfile (store) throw ; on attrape ici et
// on affiche un toast via useErrorToast. En succès, un toast de
// confirmation (couleur success, cohérente avec le badge "Terminé").
//
// Chargement du profil : demandé par la page, gaté sur l'identité (store
// identity, résolu au boot par le plugin). Appeler loadCurrentProfile()
// avant que l'identité soit connue serait un no-op silencieux (sa garde) et
// la page resterait sur "Chargement…" : le watcher ci-dessous ne l'appelle
// qu'une fois l'identité résolue. L'action est idempotente et déduplique en
// vol : venir de l'accueil (profil déjà chargé) ne coûte aucune requête.
// « Chargement… » tant que ni le profil ni l'échec d'identité n'ont tranché ;
// identité indisponible → même branche « Profil indisponible » + Réessayer.
//
// Conflit d'unicité du pseudo : updateMyProfile peut throw une
// ProfileError('display_name_taken') (mappée depuis le 23505 Postgres par
// le repo). On l'affiche inline sous le champ, pas en toast, pour laisser
// l'utilisateur corriger sans recharger. Même pattern que les codes
// d'erreur typés des invitations (InviteMemberError).
//
// Header (mode interne) déclaré via useAppHeader, rendu une fois par le
// layout. La déconnexion vit ici (bouton « Se déconnecter ») : le layout n'a
// plus de header legacy ni d'icône logout, donc /account en est l'unique point.
import {
  ProfileError,
  type ProfileErrorCode,
  type ProfileVisibility,
} from "../types";

const profileStore = useProfileStore();
const { currentProfile, currentProfileVisibility, hasFetchedCurrentProfile } =
  storeToRefs(profileStore);
const identityStore = useIdentityStore();
const { currentUserId, identityUnavailable } = storeToRefs(identityStore);
const { showError } = useErrorToast();
const toast = useToast();
const client = useSupabaseClient();

const friendshipStore = useFriendshipStore();
const { receivedRequestCount } = storeToRefs(friendshipStore);

// Chargement gaté sur l'identité (cf. commentaire d'en-tête). Les listes
// d'amis sont RAFRAÎCHIES (pas le lazy) pour que le compteur de demandes
// reçues reflète la session en cours ; leur échec reste silencieux — un
// compteur absent ne bloque pas la page de compte.
watch(
  currentUserId,
  (userId) => {
    if (userId !== null) {
      void profileStore.loadCurrentProfile();
      void friendshipStore.refreshFriendships();
    }
  },
  { immediate: true },
);

// Retour vers MON profil public (sens de navigation inversé : on arrive
// ici depuis le profil). Fallback accueil si l'identité n'est pas résolue.
const profileBackTo = computed(() =>
  currentUserId.value ? `/profile/${currentUserId.value}` : "/",
);

// Config header. watchEffect pour suivre profileBackTo (résolu après hydratation).
const { set: setHeader } = useAppHeader();
watchEffect(() => {
  setHeader({
    mode: "interne",
    kicker: "Compte",
    title: "Mon compte",
    back: { label: "Profil", to: profileBackTo.value },
  });
});

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
    await profileStore.updateMyProfile(state.displayName.trim());
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

// --- Confidentialité du profil (A4, C1/C5) ---
// Deux cartes (le sélecteur des tournois et matchs libres), une modale qui
// explique avant de confirmer, un toast qui nomme le nouvel état. Les
// cartes ne sont liées qu'à SENS UNIQUE (:model-value + @update, pas de
// v-model) : la carte active ne bouge qu'une fois la bascule persistée —
// Annuler ne produit aucun aller-retour visuel. Deux invariants tiennent
// cette garantie :
//  1. la section n'est rendue (v-if INLINE, jamais v-show, jamais de
//     `?? undefined`) que réglage connu : reka-ui fige son mode
//     contrôlé/passif au montage sur `modelValue === undefined` — monté
//     sans valeur, le groupe deviendrait autonome pour toute sa vie et la
//     carte bougerait sur Annuler ;
//  2. le sélecteur émet aussi au tap sur la carte DÉJÀ active : le handler
//     ignore ce cas (règle pure visibilityChangeToConfirm, testée) — sans
//     ce garde, retaper « Public » ouvrirait « Rendre mon profil privé ? »,
//     le seul geste de l'écran qui ne doit jamais partir par accident.
// La copie des cartes nomme le CONTENU, pas la page : la page reste ouverte
// à tous (le pseudo est toujours visible), ce sont les statistiques et le
// journal qui se protègent.
const PROFILE_VISIBILITY_OPTIONS = [
  {
    value: "public",
    label: "Public",
    description: "Statistiques et journal visibles par tous",
    icon: "i-lucide-globe",
  },
  {
    value: "private",
    label: "Privé",
    description: "Statistiques et journal réservés à vos amis",
    icon: "i-lucide-lock",
  },
];

// La cible de la bascule en attente de confirmation — la carte tapée. Null
// tant qu'aucune carte n'a été tapée : la modale n'est pas montée avant.
const pendingVisibility = ref<ProfileVisibility | null>(null);
const isVisibilityModalOpen = ref(false);
const isSubmittingVisibility = ref(false);

// Payload `string | undefined` : le modèle de CarteSelection est un string
// non requis. La règle pure décide s'il y a une bascule à confirmer
// (recadrage du type + filtre de la carte déjà active — invariant 2).
function openVisibilityChangeConfirmation(tappedValue: string | undefined) {
  const targetVisibility = visibilityChangeToConfirm(
    tappedValue,
    currentProfileVisibility.value,
  );
  if (targetVisibility === null) return;
  pendingVisibility.value = targetVisibility;
  isVisibilityModalOpen.value = true;
}

async function confirmVisibilityChange() {
  const targetVisibility = pendingVisibility.value;
  if (targetVisibility === null || isSubmittingVisibility.value) return;
  isSubmittingVisibility.value = true;
  try {
    await profileStore.updateMyProfileVisibility(targetVisibility);
    isVisibilityModalOpen.value = false;
    // Une bascule de réglage NOMME le nouvel état dans les deux sens (choix
    // assumé) : la doctrine des actions d'amitié — ce qui disparaît
    // confirme, ce qui apparaît nomme — ne s'applique pas à un réglage, qui
    // n'est ni une création ni une suppression.
    toast.add({
      title:
        targetVisibility === "private"
          ? "Votre profil est maintenant privé."
          : "Votre profil est maintenant public.",
      color: "success",
      icon: "i-lucide-check",
    });
  } catch (error) {
    // La modale reste ouverte, la carte active n'a pas bougé : l'état à
    // l'écran est toujours celui de la base.
    showError(error);
  } finally {
    isSubmittingVisibility.value = false;
  }
}

// Aperçu extérieur (C6) : son profil, composé par la base comme pour un
// tiers. Depuis le réglage, là où il prend son sens.
const previewAsStrangerTo = computed(() =>
  currentUserId.value
    ? `/profile/${currentUserId.value}?preview=stranger`
    : "/",
);

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
    // Identité indisponible : relancer seulement la résolution — si elle
    // aboutit, le watcher charge. Sinon c'est le profil qui a échoué.
    if (currentUserId.value === null) {
      await identityStore.resolveForCurrentSession();
      return;
    }
    await profileStore.loadCurrentProfile();
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
  <div>
    <p
      v-if="!hasFetchedCurrentProfile && !identityUnavailable"
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

      <!-- Confidentialité du profil (A4) — hors du UForm du pseudo : la
           bascule ne dépend pas du formulaire. v-if INLINE sur l'élément qui
           enveloppe CarteSelection (invariant 1, cf. script). -->
      <section
        v-if="currentProfileVisibility !== null"
        class="mt-6 space-y-2.75"
      >
        <h2 :class="FIELD_LABEL_CLASS">Confidentialité du profil</h2>
        <CarteSelection
          :model-value="currentProfileVisibility"
          :options="PROFILE_VISIBILITY_OPTIONS"
          :columns="2"
          name="profileVisibility"
          @update:model-value="openVisibilityChangeConfirmation"
        />
        <p class="font-sans text-xs text-(--pk-muted)">
          Votre pseudo reste toujours visible.
        </p>
        <UButton
          :to="previewAsStrangerTo"
          variant="ghost"
          color="neutral"
          icon="i-lucide-eye"
          block
          class="h-11 justify-start font-disp text-[12.5px] font-extrabold tracking-[0.03em] uppercase"
          :ui="{ leadingIcon: 'size-4.5' }"
        >
          Voir mon profil comme un non-ami
        </UButton>
      </section>

      <ProfileVisibilityToggleModal
        v-if="pendingVisibility !== null"
        v-model:open="isVisibilityModalOpen"
        :target-visibility="pendingVisibility"
        :is-submitting="isSubmittingVisibility"
        @confirmed="confirmVisibilityChange"
      />

      <!-- Entrée « Amis » (A3) : navigation vers l'écran des amis, avec le
           nombre de demandes reçues en attente — rien quand il n'y en a
           pas. color="navy" (naviguer) pour la distinguer du dashed
           « Se déconnecter » (agir). -->
      <UButton
        to="/friends"
        color="navy"
        block
        trailing-icon="i-lucide-chevron-right"
        class="mt-3 h-13 justify-between rounded-[13px] px-4 font-disp text-[13.5px] font-extrabold tracking-[0.04em] uppercase"
      >
        <span class="flex items-center gap-2">
          Amis
          <UBadge
            v-if="receivedRequestCount > 0"
            color="secondary"
            variant="solid"
            size="sm"
          >
            {{ receivedRequestCount }}
          </UBadge>
        </span>
      </UButton>

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
  </div>
</template>
