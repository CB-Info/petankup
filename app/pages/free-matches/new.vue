<script setup lang="ts">
// Création d'un match libre (H2.b) : format, joueurs des deux camps, score
// final, options (date, visibilité). Objectif produit : noter une partie en
// moins de 30 secondes — défauts pré-remplis (doublette, aujourd'hui,
// privé), le créateur déjà placé, le score en gros chiffres.
//
// Pattern d'erreurs : les actions du store throw. FreeMatchError typée →
// message sous le champ concerné (score, date) ou alerte de formulaire ;
// autre erreur → toast via useErrorToast. Jamais le texte brut d'une erreur.
//
// Chargement gaté sur l'identité (store identity) : le pseudo du créateur
// (store profil, loadCurrentProfile) est nécessaire — la base exige un nom
// pour chaque joueur, lié ou non — d'où « Chargement… » avant, et la branche
// d'erreur + Réessayer si le profil ou l'identité manquent.
//
// Header (mode interne) déclaré via useAppHeader, rendu une fois par le layout.
import type { Form } from "@nuxt/ui";
import type {
  CreateFreeMatchInput,
  CreateFreeMatchPlayerInput,
  FreeMatchErrorCode,
  FreeMatchFormat,
  FreeMatchSide,
  FreeMatchVisibility,
} from "../../types";
import { FreeMatchError } from "../../types";
import {
  FREE_MATCH_FORMAT_LABELS,
  FREE_MATCH_MAX_SCORE,
  emptySlot,
  leadingSideOf,
  moveCreatorToSide,
  playersPerSide,
  resizeSide,
} from "../../utils/free-match";
import type { FreeMatchSlot } from "../../utils/free-match";
import {
  freeMatchErrorField,
  freeMatchErrorMessage,
} from "../../utils/free-match-errors";
import { buildFreeMatchSchema } from "../../utils/freeMatchSchema";
import type {
  FreeMatchFormValues,
  FreeMatchSchema,
} from "../../utils/freeMatchSchema";
import { toLocalIsoDate } from "../../utils/format";

const identityStore = useIdentityStore();
const { currentUserId, identityUnavailable, lastResolveError } =
  storeToRefs(identityStore);
const profileStore = useProfileStore();
const { currentProfile, lastLoadCurrentProfileError } =
  storeToRefs(profileStore);
const freeMatchStore = useFreeMatchStore();
const { showError } = useErrorToast();

// Config header : statique, posée une fois au montage.
const { set: setHeader } = useAppHeader();
setHeader({
  mode: "interne",
  kicker: "Match libre",
  title: "Nouveau match",
  subtitle: "Notez la partie en quelques secondes",
  back: { label: "Accueil", to: "/" },
});

// Pseudo du créateur : demandé dès que l'identité est connue (idempotent,
// dédupliqué en vol — venir de l'accueil ne coûte aucune requête).
watch(
  currentUserId,
  (userId) => {
    if (userId !== null) void profileStore.loadCurrentProfile();
  },
  { immediate: true },
);

// Le créateur, prêt à être placé : identité ET pseudo live — toujours lié à
// un compte, d'où un userId non nullable (contrairement à un FreeMatchSlot).
// null tant que l'un des deux manque (le formulaire n'est pas rendu avant).
type CreatorSlot = { userId: string; displayName: string };

const creator = computed<CreatorSlot | null>(() => {
  const userId = currentUserId.value;
  const profile = currentProfile.value;
  if (userId === null || profile === null || profile.id !== userId) return null;
  return { userId, displayName: profile.displayName };
});

// Erreur bloquante avant le formulaire : profil courant en échec, ou
// identité indisponible (résolution en échec sans identité connue).
const setupError = computed(
  () =>
    lastLoadCurrentProfileError.value ??
    (identityUnavailable.value ? lastResolveError.value : null),
);

const isRetrying = ref(false);

async function retrySetup() {
  if (isRetrying.value) return;
  isRetrying.value = true;
  try {
    // Identité indisponible : relancer seulement la résolution — si elle
    // aboutit, le watcher charge le profil. Sinon c'est le profil qui a
    // échoué : le recharger. Jamais les deux.
    if (currentUserId.value === null) {
      await identityStore.resolveForCurrentSession();
      return;
    }
    await profileStore.loadCurrentProfile();
  } finally {
    isRetrying.value = false;
  }
}

// --- État du formulaire ---

const SIDES: readonly FreeMatchSide[] = ["A", "B"];
const DEFAULT_FORMAT: FreeMatchFormat = "doublette";

// Date du jour locale, figée au montage (la page vit quelques secondes).
const todayLocalIso = toLocalIsoDate(new Date());

// sideA / sideB = slots HORS créateur (cf. FreeMatchSidesLayout) : le camp
// du créateur en a un de moins, sa ligne verrouillée complète l'effectif.
// Scores en string : vide toléré pendant la frappe, converti à la
// validation (précédent ScoreInputModal).
const state = reactive<{
  format: FreeMatchFormat;
  creatorSide: FreeMatchSide;
  sideA: FreeMatchSlot[];
  sideB: FreeMatchSlot[];
  scoreA: string;
  scoreB: string;
  playedOn: string;
  // Date jamais touchée → on laisse la base poser « aujourd'hui » en date de
  // Paris plutôt que d'envoyer la date locale du navigateur.
  playedOnTouched: boolean;
  visibility: FreeMatchVisibility;
}>({
  format: DEFAULT_FORMAT,
  creatorSide: "A",
  sideA: [emptySlot()],
  sideB: [emptySlot(), emptySlot()],
  scoreA: "",
  scoreB: "",
  playedOn: todayLocalIso,
  playedOnTouched: false,
  visibility: "private",
});

const formatOptions = [
  {
    value: "tete_a_tete",
    label: FREE_MATCH_FORMAT_LABELS.tete_a_tete,
    description: "1 contre 1",
    icon: "i-lucide-user",
  },
  {
    value: "doublette",
    label: FREE_MATCH_FORMAT_LABELS.doublette,
    description: "2 contre 2",
    icon: "i-lucide-users",
  },
  {
    value: "triplette",
    label: FREE_MATCH_FORMAT_LABELS.triplette,
    description: "3 contre 3",
    icon: "i-lucide-users-round",
  },
];

const creatorSideOptions = [
  { value: "A", label: "Camp A" },
  { value: "B", label: "Camp B" },
];

const visibilityOptions = [
  {
    value: "private",
    label: "Privé",
    description: "Visible des joueurs à compte",
    icon: "i-lucide-lock",
  },
  {
    value: "public",
    label: "Public",
    description: "Visible par tous",
    icon: "i-lucide-globe",
  },
];

function slotsOf(side: FreeMatchSide): FreeMatchSlot[] {
  return side === "A" ? state.sideA : state.sideB;
}

// Taille cible d'un camp hors créateur, pour le format courant.
function targetSlotCount(side: FreeMatchSide, format: FreeMatchFormat): number {
  const perSide = playersPerSide(format);
  return side === state.creatorSide ? perSide - 1 : perSide;
}

// Changement de format : chaque camp garde ses joueurs renseignés dans
// l'ordre (cf. resizeSide) ; un rétrécissement qui écarte des joueurs
// renseignés est signalé sous le sélecteur.
const droppedPlayersNotice = ref<string | null>(null);

watch(
  () => state.format,
  (format) => {
    const resizedA = resizeSide(state.sideA, targetSlotCount("A", format));
    const resizedB = resizeSide(state.sideB, targetSlotCount("B", format));
    state.sideA = resizedA.slots;
    state.sideB = resizedB.slots;
    const droppedCount =
      resizedA.droppedFilledCount + resizedB.droppedFilledCount;
    droppedPlayersNotice.value =
      droppedCount > 0
        ? `${droppedCount} joueur${droppedCount > 1 ? "s" : ""} retiré${droppedCount > 1 ? "s" : ""} : en ${FREE_MATCH_FORMAT_LABELS[format].toLowerCase()}, chaque camp compte ${playersPerSide(format)} joueur${playersPerSide(format) > 1 ? "s" : ""}.`
        : null;
  },
);

// Changement de camp du créateur : échange sans perte (cf. moveCreatorToSide).
watch(
  () => state.creatorSide,
  (newSide, previousSide) => {
    const moved = moveCreatorToSide(
      { creatorSide: previousSide, sideA: state.sideA, sideB: state.sideB },
      newSide,
    );
    state.sideA = moved.sideA;
    state.sideB = moved.sideB;
  },
);

// Numéro affiché d'un slot : le créateur occupe la place 1 de son camp.
function slotPlaceholder(side: FreeMatchSide, slotIndex: number): string {
  const offset = side === state.creatorSide ? 2 : 1;
  return `Joueur ${slotIndex + offset}`;
}

// Comptes déjà présents dans le match, hors le slot considéré : le
// créateur, plus tous les slots liés des deux camps.
function takenUserIdsExcluding(side: FreeMatchSide, slotIndex: number): string[] {
  const takenUserIds: string[] = [];
  if (creator.value !== null) takenUserIds.push(creator.value.userId);
  for (const otherSide of SIDES) {
    slotsOf(otherSide).forEach((slot, otherIndex) => {
      const isTheSameSlot = otherSide === side && otherIndex === slotIndex;
      if (!isTheSameSlot && slot.userId !== null) takenUserIds.push(slot.userId);
    });
  }
  return takenUserIds;
}

// --- Score ---

function parseScore(rawScore: string): number {
  return rawScore === "" ? 0 : Number(rawScore);
}

const scoreForDisplayA = computed(() =>
  state.scoreA === "" ? null : Number(state.scoreA),
);
const scoreForDisplayB = computed(() =>
  state.scoreB === "" ? null : Number(state.scoreB),
);

const leadingSide = computed(() =>
  leadingSideOf(parseScore(state.scoreA), parseScore(state.scoreB)),
);

function setScore(side: FreeMatchSide, value: string) {
  if (side === "A") state.scoreA = value;
  else state.scoreB = value;
}

function incrementScore(side: FreeMatchSide) {
  const current = parseScore(side === "A" ? state.scoreA : state.scoreB);
  setScore(side, String(Math.min(FREE_MATCH_MAX_SCORE, current + 1)));
}

function decrementScore(side: FreeMatchSide) {
  const current = parseScore(side === "A" ? state.scoreA : state.scoreB);
  setScore(side, String(Math.max(0, current - 1)));
}

// --- Validation & soumission ---

function trimSlot(slot: FreeMatchSlot): FreeMatchSlot {
  return { userId: slot.userId, displayName: slot.displayName.trim() };
}

// Valeurs validées par le schéma : camps COMPLETS (créateur inclus, en tête
// de son camp), noms trimmés, scores numériques.
const formValues = computed<FreeMatchFormValues>(() => {
  const creatorSlot = creator.value ?? emptySlot();
  const trimmedSideA = state.sideA.map(trimSlot);
  const trimmedSideB = state.sideB.map(trimSlot);
  return {
    sideA: state.creatorSide === "A" ? [creatorSlot, ...trimmedSideA] : trimmedSideA,
    sideB: state.creatorSide === "B" ? [creatorSlot, ...trimmedSideB] : trimmedSideB,
    scoreA: parseScore(state.scoreA),
    scoreB: parseScore(state.scoreB),
    playedOn: state.playedOn,
    visibility: state.visibility,
  };
});

const schema = computed(() =>
  buildFreeMatchSchema({
    creatorUserId: currentUserId.value ?? "",
    today: todayLocalIso,
  }),
);

const form = useTemplateRef<Form<FreeMatchSchema>>("form");

// Le CTA vit dans ScoreboardEquipe (bouton simple, pas un submit) : il
// déclenche la soumission du formulaire, qui valide puis appelle onSubmit.
function submitForm() {
  void form.value?.submit();
}

// L'erreur de score est rendue sous les cartes de score (slot
// before-validate) plutôt que par un UFormField, dont le message tomberait
// sous le CTA.
const scoreErrorMessage = computed(
  () => form.value?.getErrors("score")[0]?.message ?? null,
);

const optionsOpen = ref(false);
const formError = ref<string | null>(null);
const isSubmitting = ref(false);

function markPlayedOnTouched() {
  state.playedOnTouched = true;
}

function playersOfSide(
  side: FreeMatchSide,
  slots: FreeMatchSlot[],
): CreateFreeMatchPlayerInput[] {
  return slots.map((slot) => ({
    side,
    userId: slot.userId,
    displayName: slot.displayName,
  }));
}

function buildCreateInput(): CreateFreeMatchInput {
  const values = formValues.value;
  return {
    playedOn: state.playedOnTouched ? state.playedOn : null,
    visibility: values.visibility,
    scoreA: values.scoreA,
    scoreB: values.scoreB,
    players: [
      ...playersOfSide("A", values.sideA),
      ...playersOfSide("B", values.sideB),
    ],
  };
}

// Erreur métier refusée par la base : sous le champ concerné si elle en a
// un (la section options est ouverte pour la date), sinon en alerte.
function showServerError(code: FreeMatchErrorCode) {
  const message = freeMatchErrorMessage(code);
  const field = freeMatchErrorField(code);
  if (field === null) {
    formError.value = message;
    return;
  }
  if (field === "playedOn") optionsOpen.value = true;
  form.value?.setErrors([{ name: field, message }]);
}

async function onSubmit() {
  if (isSubmitting.value) return;
  isSubmitting.value = true;
  formError.value = null;
  try {
    const createdMatchId = await freeMatchStore.createFreeMatch(buildCreateInput());
    await navigateTo(`/free-matches/${createdMatchId}`);
  } catch (error) {
    if (error instanceof FreeMatchError) {
      showServerError(error.code);
      return;
    }
    showError(error);
  } finally {
    isSubmitting.value = false;
  }
}

useHead({ title: "Nouveau match — Pétankup" });

// Styles partagés des champs (mêmes valeurs que l'écran Créer un tournoi).
const FIELD_LABEL_CLASS =
  "font-disp text-[10px] font-extrabold tracking-widest uppercase text-(--pk-muted)";
const FIELD_BASE_CLASS =
  "h-12.75 w-full rounded-(--pk-r-md) border-[1.5px] border-(--pk-line) bg-(--pk-card) px-3.5 font-sans text-[15.5px] text-(--pk-ink) placeholder:text-(--pk-muted)";
</script>

<template>
  <div>
    <div
      v-if="setupError"
      class="flex flex-col items-center gap-3 py-16 text-center"
    >
      <h2 class="font-disp text-[19px] font-extrabold text-(--pk-ink)">
        Impossible de préparer le match
      </h2>
      <p class="font-sans text-sm text-(--pk-subtle)">
        Vérifiez votre connexion et réessayez.
      </p>
      <UButton
        color="primary"
        block
        :loading="isRetrying"
        class="mt-2 h-13 rounded-[13px] font-disp text-[15px] font-extrabold tracking-[0.02em] uppercase text-(--pk-cream)"
        @click="retrySetup"
      >
        Réessayer
      </UButton>
    </div>

    <p
      v-else-if="creator === null"
      class="py-16 text-center font-sans text-sm text-(--pk-subtle)"
    >
      Chargement…
    </p>

    <UForm
      v-else
      ref="form"
      :schema="schema"
      :state="formValues"
      :validate-on="[]"
      class="space-y-5"
      @submit="onSubmit"
    >
      <UFormField
        label="Format"
        name="format"
        :ui="{ label: FIELD_LABEL_CLASS }"
      >
        <CarteSelection
          v-model="state.format"
          :options="formatOptions"
          :columns="3"
          name="format"
        />
        <p
          v-if="droppedPlayersNotice"
          class="mt-2 font-sans text-xs text-(--pk-subtle)"
        >
          {{ droppedPlayersNotice }}
        </p>
      </UFormField>

      <UFormField
        label="Mon camp"
        name="creatorSide"
        :ui="{ label: FIELD_LABEL_CLASS }"
      >
        <URadioGroup
          v-model="state.creatorSide"
          :items="creatorSideOptions"
          orientation="horizontal"
          variant="table"
          size="lg"
        />
      </UFormField>

      <UFormField
        v-for="side in SIDES"
        :key="side"
        :label="`Camp ${side}`"
        :name="`side${side}`"
        :ui="{ label: FIELD_LABEL_CLASS }"
      >
        <div class="space-y-2">
          <FreeMatchPlayerInput
            v-if="state.creatorSide === side"
            locked
            :user-id="creator.userId"
            :display-name="creator.displayName"
            placeholder=""
            :taken-user-ids="[]"
          />
          <FreeMatchPlayerInput
            v-for="(slot, slotIndex) in slotsOf(side)"
            :key="`${side}-${slotIndex}`"
            v-model:user-id="slot.userId"
            v-model:display-name="slot.displayName"
            :placeholder="slotPlaceholder(side, slotIndex)"
            :taken-user-ids="takenUserIdsExcluding(side, slotIndex)"
          />
        </div>
      </UFormField>

      <div>
        <p :class="FIELD_LABEL_CLASS" class="mb-2">Score final</p>
        <ScoreboardEquipe
          mode="saisie"
          editable
          team-a-name="Camp A"
          team-b-name="Camp B"
          :score-a="scoreForDisplayA"
          :score-b="scoreForDisplayB"
          :leading-side="leadingSide"
          validate-label="ENREGISTRER LE MATCH"
          :validate-loading="isSubmitting"
          @increment="incrementScore"
          @decrement="decrementScore"
          @set-score="setScore"
          @validate="submitForm"
        >
          <template #before-validate>
            <p
              v-if="scoreErrorMessage"
              class="mb-3 text-center font-sans text-sm text-error"
            >
              {{ scoreErrorMessage }}
            </p>

            <UCollapsible v-model:open="optionsOpen" :unmount-on-hide="false">
              <UButton
                type="button"
                variant="ghost"
                color="neutral"
                block
                :trailing-icon="
                  optionsOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'
                "
                class="h-11 font-disp text-xs font-extrabold tracking-[0.04em] uppercase text-(--pk-subtle)"
              >
                Plus d'options
              </UButton>

              <template #content>
                <div class="space-y-4 pt-3">
                  <UFormField
                    label="Date du match"
                    name="playedOn"
                    :ui="{ label: FIELD_LABEL_CLASS }"
                  >
                    <UInput
                      v-model="state.playedOn"
                      type="date"
                      :max="todayLocalIso"
                      icon="i-lucide-calendar"
                      variant="none"
                      class="w-full"
                      :ui="{
                        base: `${FIELD_BASE_CLASS} ps-10.5`,
                        leadingIcon: 'size-4.5 text-(--pk-muted)',
                      }"
                      @update:model-value="markPlayedOnTouched"
                    />
                  </UFormField>

                  <UFormField
                    label="Visibilité"
                    name="visibility"
                    :ui="{ label: FIELD_LABEL_CLASS }"
                  >
                    <CarteSelection
                      v-model="state.visibility"
                      :options="visibilityOptions"
                      :columns="2"
                      name="visibility"
                    />
                  </UFormField>
                </div>
              </template>
            </UCollapsible>

            <UAlert
              v-if="formError"
              color="error"
              variant="soft"
              :description="formError"
              class="mt-3"
            />
          </template>
        </ScoreboardEquipe>
      </div>
    </UForm>
  </div>
</template>
