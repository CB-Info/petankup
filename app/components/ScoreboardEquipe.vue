<script setup lang="ts">
import type { BouleTone } from "./BouleAvatar.vue";

// Bloc de score d'un match (Direction C), en deux modes :
// - saisie : deux demi-cartes, gros chiffres Space Grotesk, boutons +/−,
//   médaillon VS, état meneur en corail, CTA Valider ;
// - liste : carte compacte d'un match joué (gagnant surligné) ou à jouer
//   (bouton SCORE).
// Zéro logique métier : qui mène / qui gagne est REÇU en props, jamais déduit.
// Seule la forme « à jouer » dérive de scores null (forme des données, pas une
// règle métier). Boutons natifs stylés — UButton n'apporterait que des
// surcharges vu le rendu très spécifique (audit acté en plan).

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
  }>(),
  {
    leadingSide: null,
    winnerSide: null,
    toneA: "horizon",
    toneB: "sand",
    validateDisabled: false,
  },
);

const emit = defineEmits<{
  increment: [side: TeamSide];
  decrement: [side: TeamSide];
  validate: [];
  score: [];
}>();

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

        <p
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
            @click="emit('decrement', entry.side)"
          >
            −
          </button>
          <button
            type="button"
            class="h-11.5 flex-1 rounded-(--pk-r-md) font-disp text-2xl font-bold text-(--pk-cream)"
            :class="entry.isLeading ? 'bg-primary' : 'bg-(--pk-navy)'"
            :aria-label="`Ajouter un point à ${entry.name}`"
            @click="emit('increment', entry.side)"
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

    <button
      type="button"
      class="mt-4 h-14 w-full rounded-[14px] bg-primary font-disp text-[15px] font-extrabold tracking-[0.03em] text-(--pk-cream) shadow-(--pk-shadow-clay-lg) disabled:opacity-50 disabled:shadow-none"
      :disabled="validateDisabled"
      @click="emit('validate')"
    >
      Valider le score
    </button>
  </div>

  <!-- ───────────── Mode liste ───────────── -->
  <article
    v-else
    class="flex items-stretch overflow-hidden rounded-(--pk-r-card) border border-(--pk-line) bg-(--pk-card) shadow-(--pk-shadow-card-lg)"
  >
    <template v-if="isPlayed">
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
    </template>

    <div v-else class="flex flex-1 items-center gap-3 p-4">
      <div class="flex-1 space-y-1">
        <h3 class="font-disp text-[14.5px] font-bold text-(--pk-ink)">
          {{ teamAName }}
        </h3>
        <h3 class="font-disp text-[14.5px] font-bold text-(--pk-ink)">
          {{ teamBName }}
        </h3>
      </div>
      <button
        type="button"
        class="inline-flex h-12 items-center gap-1.5 rounded-(--pk-r-md) bg-primary px-4.5 font-disp text-[13px] font-extrabold tracking-[0.04em] uppercase text-(--pk-cream)"
        @click="emit('score')"
      >
        <UIcon name="i-lucide-plus" class="size-4" />
        Score
      </button>
    </div>
  </article>
</template>
