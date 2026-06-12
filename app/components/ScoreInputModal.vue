<script setup lang="ts">
// Pattern d'erreurs : les actions du store throw ; on attrape ici et on
// affiche un toast via useErrorToast (voir composables/useErrorToast).
// La validation métier (entiers, ≥13, pas d'égalité) reste affichée
// inline via errorMessage : c'est une erreur utilisateur, pas système.
import type { Match, ScoreValidationResult, Team } from "../types";

type TeamSide = "A" | "B";

const props = defineProps<{
  open: boolean;
  match: Match | null;
  teamA: Team | null;
  teamB: Team | null;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "saved"): void;
}>();

const tournamentStore = useTournamentStore();
const { showError } = useErrorToast();

const openModel = computed({
  get: () => props.open,
  set: (value: boolean) => emit("update:open", value),
});

// On garde les scores en string pour bien gérer le champ vide (sinon
// type=number force "0" et empêche d'effacer pour retaper).
const scoreAInput = ref("");
const scoreBInput = ref("");
const errorMessage = ref<string | null>(null);
const isSubmitting = ref(false);

function resetFromMatch() {
  errorMessage.value = null;
  if (props.match && props.match.status === "completed") {
    scoreAInput.value = String(props.match.scoreA ?? "");
    scoreBInput.value = String(props.match.scoreB ?? "");
  } else {
    // Nouveau match : 0 réel d'entrée de jeu (pas un champ vide affiché
    // « 0 »). Le vide reste toléré pendant la frappe.
    scoreAInput.value = "0";
    scoreBInput.value = "0";
  }
}

watch(
  () => [props.open, props.match?.id] as const,
  ([isOpen]) => {
    if (isOpen) resetFromMatch();
  },
  { immediate: true },
);

function parseScore(rawScore: string): number {
  const parsed = Number.parseInt(rawScore, 10);
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

// Normalisation d'entrée : un champ resté vide vaut 0. La règle de
// validation (entiers, ≥13, pas d'égalité) ne change pas.
function normalizedScoreInput(raw: string): string {
  return raw.trim() === "" ? "0" : raw;
}

// ── Adaptateurs de PRÉSENTATION entre l'état string (champ vide permis)
// et les props numériques de ScoreboardEquipe. Aucune règle métier ici :
// la validation reste dans onSubmit (déléguée au store).

function displayScore(rawScore: string): number | null {
  const parsed = Number.parseInt(rawScore, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

const scoreADisplay = computed(() => displayScore(scoreAInput.value));
const scoreBDisplay = computed(() => displayScore(scoreBInput.value));

// Badge MÈNE : présentation dérivée des deux saisies en cours (null si
// vide ou égalité) — pas une règle métier.
const leadingSide = computed<TeamSide | null>(() => {
  const scoreA = scoreADisplay.value;
  const scoreB = scoreBDisplay.value;
  if (scoreA === null || scoreB === null || scoreA === scoreB) return null;
  return scoreA > scoreB ? "A" : "B";
});

function setScoreInput(side: TeamSide, value: string) {
  if (side === "A") scoreAInput.value = value;
  else scoreBInput.value = value;
}

// Steppers +/− : même source de vérité que la saisie clavier. Clamp à 0
// (reproduit le min="0" de l'ancien champ), champ vide compté comme 0.
function stepScore(side: TeamSide, delta: 1 | -1) {
  const currentRaw = side === "A" ? scoreAInput.value : scoreBInput.value;
  const current = displayScore(currentRaw) ?? 0;
  setScoreInput(side, String(Math.max(0, current + delta)));
}

async function onSubmit() {
  if (isSubmitting.value || !props.match) return;

  const scoreA = parseScore(normalizedScoreInput(scoreAInput.value));
  const scoreB = parseScore(normalizedScoreInput(scoreBInput.value));

  if (Number.isNaN(scoreA) || Number.isNaN(scoreB)) {
    errorMessage.value = "Les scores doivent être des entiers.";
    return;
  }

  isSubmitting.value = true;
  try {
    // Le store appelle déjà validateScore en interne et nous renvoie
    // { valid, error } : on s'appuie sur ce retour plutôt que de
    // dupliquer la validation côté composant.
    const result: ScoreValidationResult = await tournamentStore.submitScore(
      props.match.id,
      scoreA,
      scoreB,
    );
    if (!result.valid) {
      errorMessage.value = result.error ?? "Score invalide.";
      return;
    }
    emit("saved");
    openModel.value = false;
  } catch (error) {
    showError(error);
  } finally {
    isSubmitting.value = false;
  }
}

function close() {
  openModel.value = false;
}
</script>

<template>
  <UModal v-model:open="openModel" fullscreen>
    <template #content>
      <div class="flex h-full flex-col overflow-y-auto bg-default">
        <!-- TODO: compléter le kicker en « MANCHE N · MATCH N » quand le
             numéro de match dans la manche sera ajouté au modèle Match
             (chantier séparé). Omission volontaire : donnée indisponible. -->
        <AppHeader
          :kicker="`Manche ${match?.roundNumber ?? ''}`"
          title="Saisie du score"
          closable
          @close="close"
        />

        <form
          class="flex-1 space-y-4 px-4.5 pt-5.5 pb-10"
          @submit.prevent="onSubmit"
        >
          <ScoreboardEquipe
            mode="saisie"
            editable
            :team-a-name="teamA?.name ?? 'Équipe A'"
            :team-b-name="teamB?.name ?? 'Équipe B'"
            :score-a="scoreADisplay"
            :score-b="scoreBDisplay"
            :leading-side="leadingSide"
            :validate-loading="isSubmitting"
            @set-score="setScoreInput"
            @increment="stepScore($event, 1)"
            @decrement="stepScore($event, -1)"
            @validate="onSubmit"
          >
            <template #before-validate>
              <UAlert
                icon="i-lucide-target"
                color="neutral"
                variant="soft"
                :ui="{
                  root: 'items-center rounded-(--pk-r-md) bg-(--pk-card) px-3.5 py-2.75',
                  icon: 'size-4 text-primary',
                  description: 'font-sans text-[13px] text-(--pk-ink) opacity-100',
                }"
              >
                <template #description>
                  Le premier à <strong>13 points</strong> gagne la partie.
                </template>
              </UAlert>
            </template>
          </ScoreboardEquipe>

          <p
            v-if="errorMessage"
            class="rounded-(--pk-r-md) bg-error/10 px-3.5 py-2.75 font-sans text-sm text-error"
            role="alert"
          >
            {{ errorMessage }}
          </p>

          <UButton
            type="button"
            variant="ghost"
            color="neutral"
            block
            class="h-12 rounded-[14px] font-disp text-[13.5px] font-extrabold tracking-[0.04em] uppercase text-(--pk-subtle)"
            @click="close"
          >
            Annuler
          </UButton>
        </form>
      </div>
    </template>
  </UModal>
</template>
