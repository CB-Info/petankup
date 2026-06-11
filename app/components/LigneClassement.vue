<script setup lang="ts">
// Ligne du classement : rang (ou trophée pour le leader), boule médaille,
// nom d'équipe, colonnes V / D / DIFF. La règle rang→couleur de boule vit
// dans l'util medalTone (appelée ici, jamais dupliquée). Le composant formate
// le signe du diff (« +11 », « -13 ») ; il ne calcule ni rang ni stats.
// L'alignement des colonnes est partagé avec LigneClassementEntete — toute
// modification de largeur/gap doit être répercutée des deux côtés.

const props = defineProps<{
  rank: number;
  teamName: string;
  wins: number;
  losses: number;
  diff: number;
}>();

const isLeader = computed(() => props.rank === 1);
const tone = computed(() => medalTone(props.rank));

const formattedDiff = computed(() =>
  props.diff > 0 ? `+${props.diff}` : String(props.diff),
);

// Couleur du NUMÉRO de rang (lignes non-leader) : podium en encre, reste en
// muted. Règle distincte du tone de boule (medalTone) — ne pas confondre.
const rankNumberClass = computed(() =>
  props.rank <= 3 ? "text-(--pk-ink)" : "text-(--pk-muted)",
);

const diffClass = computed(() => {
  if (isLeader.value) return "text-(--pk-navy)";
  if (props.diff > 0) return "text-success";
  if (props.diff < 0) return "text-primary";
  return "text-(--pk-ink)"; // diff nul : ni gain ni perte, encre neutre
});
</script>

<template>
  <div
    class="flex items-center gap-2.75 rounded-[14px] border px-4 py-3.25"
    :class="
      isLeader
        ? 'border-transparent bg-secondary shadow-[0_12px_26px_-12px_rgb(var(--pk-gold-rgb)/0.6)]'
        : 'border-(--pk-line) bg-(--pk-card) shadow-(--pk-shadow-card-lg)'
    "
  >
    <span class="w-6 shrink-0 text-center">
      <UIcon
        v-if="isLeader"
        name="i-lucide-trophy"
        class="size-5 text-(--pk-navy)"
      />
      <span
        v-else
        class="font-num text-[17px] font-bold"
        :class="rankNumberClass"
      >
        {{ rank }}
      </span>
    </span>

    <!-- Leader : anneau blanc autour de la boule. Seule la partie « ring »
         de l'ombre prescrite est posée ici — la partie inset (terminator) est
         déjà rendue par BouleAvatar lui-même, aux mêmes valeurs à Ø32. -->
    <span
      class="shrink-0 rounded-full"
      :class="isLeader ? 'shadow-[0_0_0_2px_rgba(255,255,255,0.5)]' : ''"
    >
      <BouleAvatar :tone="tone" :size="32" />
    </span>

    <h3
      class="min-w-0 flex-1 truncate font-disp text-[15px] font-bold tracking-[-0.01em]"
      :class="isLeader ? 'text-(--pk-navy)' : 'text-(--pk-ink)'"
    >
      {{ teamName }}
    </h3>

    <span
      class="w-7 text-center font-num text-base font-bold"
      :class="isLeader ? 'text-(--pk-navy)' : 'text-(--pk-ink)'"
    >
      {{ wins }}
    </span>

    <span
      class="w-7 text-center font-num text-base font-semibold"
      :class="
        isLeader ? 'text-[rgb(var(--pk-navy-rgb)/0.6)]' : 'text-(--pk-muted)'
      "
    >
      {{ losses }}
    </span>

    <span
      class="w-10 text-right font-num text-[15px] font-bold"
      :class="diffClass"
    >
      {{ formattedDiff }}
    </span>
  </div>
</template>
