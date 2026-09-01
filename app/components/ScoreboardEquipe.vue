<script setup lang="ts">
import type { BouleTone } from "./BouleAvatar.vue";
import { clampScoreToInputBounds } from "../utils/score";

// Bloc de score d'un match (Direction C), en deux modes :
// - saisie : deux demi-cartes, gros chiffres Space Grotesk, boutons +/−,
//   médaillon VS, état meneur en corail, CTA Valider ;
// - liste : carte compacte d'un match joué (gagnant surligné) ou à jouer
//   (bouton SCORE).
// Zéro logique métier : qui mène / qui gagne est REÇU en props, jamais déduit.
// Seule la forme « à jouer » dérive de scores null (forme des données, pas une
// règle métier). Exception assumée, côté mécanique d'input (pas une règle
// métier) : en mode saisie, les steppers +/− calculent la prochaine valeur
// bornée [0, 13] via clampScoreToInputBounds (utils/score, la source unique —
// jamais dupliquée ici) et l'émettent par `set-score` ; la saisie clavier
// reste purgée chiffres-only, la validation reste chez le parent à la
// soumission, et les props d'affichage ne sont jamais clampées.
// Boutons : les steppers +/− restent natifs (fonds
// état-dépendants page/blanc/navy/corail selon le meneur, hors système
// UButton) ; les actions standards (CTA Valider, SCORE) sont des UButton
// (états hover/focus/disabled/loading natifs) — règle actée à l'audit boutons.
//
// `canScore` (mode liste) : le DROIT de saisir/corriger est décidé par
// l'écran (owner, tournoi non terminé) et reçu ici. À true : le bouton
// SCORE émet `score`, et la carte d'un match joué devient cliquable
// (correction de score) en émettant aussi `score`. À false : « À jouer »
// en texte simple, carte jouée inerte.

type ScoreboardMode = "saisie" | "liste";
type TeamSide = "A" | "B";

const props = withDefaults(
  defineProps<{
    mode: ScoreboardMode;
    teamAName: string;
    teamBName: string;
    scoreA: number | null;
    scoreB: number | null;
    leadingSide?: TeamSide | null;
    winnerSide?: TeamSide | null;
    toneA?: BouleTone;
    toneB?: BouleTone;
    validateDisabled?: boolean;
    /** Spinner du CTA Valider pendant l'enregistrement async (câblé par l'écran). */
    validateLoading?: boolean;
    /** Droit de saisir/corriger un score (mode liste) — reçu, jamais déduit. */
    canScore?: boolean;
    /**
     * Gros chiffre éditable au clavier (mode saisie uniquement). Coexiste
     * avec les steppers : les deux chemins émettent, le parent reste la
     * source de vérité de la valeur.
     */
    editable?: boolean;
    /**
     * Libellé du CTA de validation (mode saisie). Défaut = tournoi ; le match
     * libre l'emploie pour « ENREGISTRER LE MATCH » (même bloc, même geste).
     */
    validateLabel?: string;
  }>(),
  {
    leadingSide: null,
    winnerSide: null,
    toneA: "horizon",
    toneB: "sand",
    validateDisabled: false,
    validateLoading: false,
    canScore: true,
    editable: false,
    validateLabel: "VALIDER LE SCORE",
  },
);

const emit = defineEmits<{
  validate: [];
  score: [];
  /**
   * Nouvelle valeur d'un score, toujours en string : saisie clavier
   * filtrée chiffres-only (peut être vide) ou stepper +/− déjà borné
   * [0, 13]. Le parent reste la source de vérité de la valeur.
   */
  "set-score": [side: TeamSide, value: string];
}>();

// Saisie clavier du gros chiffre : on purge les non-chiffres directement
// dans le champ puis on émet la string filtrée — aucune validation métier
// ici (elle reste chez le parent, à la soumission).
function onScoreInput(side: TeamSide, event: Event) {
  const input = event.target as HTMLInputElement;
  const filtered = input.value.replace(/\D/g, "");
  input.value = filtered;
  emit("set-score", side, filtered);
}

// Steppers +/− : le composant calcule lui-même la prochaine valeur, bornée
// [0, 13] par clampScoreToInputBounds (util partagée, jamais dupliquée ici),
// et l'émet sur le même canal que le clavier. Champ vide (score null) compté
// comme 0. Mécanique d'input : la validation du score reste chez le parent,
// à la soumission.
function stepScore(side: TeamSide, delta: 1 | -1) {
  const currentScore = (side === "A" ? props.scoreA : props.scoreB) ?? 0;
  emit("set-score", side, String(clampScoreToInputBounds(currentScore + delta)));
}

// La carte d'un match joué n'est un vrai <button> que si la correction de
// score est permise — sinon un simple <div> inerte, sans handler.
function onPlayedCardClick() {
  if (props.canScore) emit("score");
}

const slots = useSlots();

// Les deux côtés sont symétriques : on les assemble une fois pour itérer dans
// le template au lieu de dupliquer chaque demi-carte.
const sides = computed(() => [
  {
    side: "A" as TeamSide,
    name: props.teamAName,
    score: props.scoreA,
    tone: props.toneA,
    isLeading: props.leadingSide === "A",
    isWinner: props.winnerSide === "A",
  },
  {
    side: "B" as TeamSide,
    name: props.teamBName,
    score: props.scoreB,
    tone: props.toneB,
    isLeading: props.leadingSide === "B",
    isWinner: props.winnerSide === "B",
  },
]);

const isPlayed = computed(() => props.scoreA !== null && props.scoreB !== null);
</script>

<template>
  <!-- ───────────── Mode saisie ───────────── -->
  <div v-if="mode === 'saisie'">
    <div class="relative flex gap-3">
      <section
        v-for="entry in sides"
        :key="entry.side"
        class="relative flex-1 overflow-hidden rounded-(--pk-r-panel) border-[1.5px] px-3 pt-4 pb-3.5 transition-all duration-150"
        :class="
          entry.isLeading
            ? 'border-primary bg-primary-100 shadow-(--pk-shadow-clay-sm)'
            : 'border-(--pk-line) bg-(--pk-card) shadow-(--pk-shadow-card)'
        "
      >
        <span
          v-if="entry.isLeading"
          class="absolute top-3 right-3 font-disp text-[9.5px] font-extrabold tracking-[0.06em] uppercase text-primary"
        >
          Mène
        </span>

        <div class="flex flex-col items-center gap-2">
          <BouleAvatar :tone="entry.tone" :size="34" />
          <h3
            class="min-h-8 text-center font-disp text-sm font-bold leading-[1.1]"
            :class="entry.isLeading ? 'text-primary' : 'text-(--pk-ink)'"
          >
            {{ entry.name }}
          </h3>
        </div>

        <input
          v-if="editable"
          type="text"
          inputmode="numeric"
          pattern="[0-9]*"
          placeholder="0"
          :value="entry.score ?? ''"
          :aria-label="`Score de ${entry.name}`"
          class="mt-1.5 mb-3 w-full bg-transparent text-center font-num text-[60px] font-bold leading-none tracking-[-0.02em] focus:outline-none"
          :class="entry.isLeading ? 'text-(--pk-ink)' : 'text-(--pk-subtle)'"
          @input="onScoreInput(entry.side, $event)"
        >
        <p
          v-else
          class="mt-1.5 mb-3 text-center font-num text-[60px] font-bold leading-none tracking-[-0.02em]"
          :class="entry.isLeading ? 'text-(--pk-ink)' : 'text-(--pk-subtle)'"
        >
          {{ entry.score ?? 0 }}
        </p>

        <div class="flex gap-2">
          <button
            type="button"
            class="h-11.5 flex-1 rounded-(--pk-r-md) font-disp text-2xl font-bold"
            :class="
              entry.isLeading
                ? 'bg-white text-primary'
                : 'bg-(--pk-page) text-(--pk-subtle)'
            "
            :aria-label="`Retirer un point à ${entry.name}`"
            @click="stepScore(entry.side, -1)"
          >
            −
          </button>
          <button
            type="button"
            class="h-11.5 flex-1 rounded-(--pk-r-md) font-disp text-2xl font-bold text-(--pk-cream)"
            :class="entry.isLeading ? 'bg-primary' : 'bg-(--pk-navy)'"
            :aria-label="`Ajouter un point à ${entry.name}`"
            @click="stepScore(entry.side, 1)"
          >
            +
          </button>
        </div>
      </section>

      <span
        class="absolute top-23 left-1/2 z-2 flex size-11.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[3px] border-(--pk-page) bg-(--pk-navy) font-disp text-sm font-extrabold text-(--pk-cream) shadow-(--pk-shadow-medallion)"
      >
        VS
      </span>
    </div>

    <!-- Contenu d'écran entre les cartes et le CTA (ex. bandeau d'info) :
         le composant fournit l'emplacement, pas le contenu. -->
    <div v-if="slots['before-validate']" class="mt-4">
      <slot name="before-validate" />
    </div>

    <UButton
      color="primary"
      block
      icon="i-lucide-check"
      :disabled="validateDisabled"
      :loading="validateLoading"
      class="mt-4 h-14 gap-2.25 rounded-[14px] font-disp text-[15px] font-extrabold tracking-[0.03em] text-(--pk-cream) shadow-(--pk-shadow-clay-lg) disabled:opacity-50 disabled:shadow-none"
      :ui="{ leadingIcon: 'size-4.5' }"
      @click="emit('validate')"
    >
      {{ validateLabel }}
    </UButton>
  </div>

  <!-- ───────────── Mode liste ───────────── -->
  <article
    v-else
    class="flex overflow-hidden rounded-(--pk-r-card) border border-(--pk-line) bg-(--pk-card) shadow-(--pk-shadow-card-lg)"
  >
    <component
      :is="canScore ? 'button' : 'div'"
      v-if="isPlayed"
      v-bind="
        canScore ? { type: 'button', 'aria-label': 'Modifier le score' } : {}
      "
      class="flex flex-1 items-stretch text-left"
      @click="onPlayedCardClick"
    >
      <template v-for="(entry, sideIndex) in sides" :key="entry.side">
        <div
          v-if="sideIndex === 1"
          class="flex w-9.5 items-center justify-center font-disp text-xs font-extrabold text-(--pk-muted)"
        >
          VS
        </div>
        <div
          class="flex-1 p-3.5"
          :class="[
            entry.isWinner ? 'bg-primary-100' : '',
            sideIndex === 1 ? 'text-right' : '',
          ]"
        >
          <h3
            class="font-disp text-[14.5px] font-bold"
            :class="entry.isWinner ? 'text-primary' : 'text-(--pk-subtle)'"
          >
            {{ entry.name }}
          </h3>
          <p
            class="mt-1 font-num text-[34px] font-bold leading-none"
            :class="entry.isWinner ? 'text-(--pk-ink)' : 'text-(--pk-muted)'"
          >
            {{ entry.score }}
          </p>
        </div>
      </template>
    </component>

    <div v-else class="flex flex-1 items-center gap-3 p-4">
      <div class="min-w-0 flex-1 space-y-1">
        <h3 class="font-disp text-[14.5px] font-bold text-(--pk-ink)">
          {{ teamAName }}
        </h3>
        <h3 class="font-disp text-[14.5px] font-bold text-(--pk-ink)">
          {{ teamBName }}
        </h3>
      </div>
      <UButton
        v-if="canScore"
        color="primary"
        icon="i-lucide-plus"
        class="h-12 shrink-0 gap-1.75 rounded-(--pk-r-md) px-4.5 font-disp text-[13px] font-extrabold tracking-[0.04em] uppercase text-(--pk-cream)"
        :ui="{ leadingIcon: 'size-4' }"
        @click="emit('score')"
      >
        Score
      </UButton>
      <p v-else class="shrink-0 font-sans text-sm text-(--pk-muted)">À jouer</p>
    </div>
  </article>
</template>
