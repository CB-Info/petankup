<script setup lang="ts">
// Une entrée du journal de bord (Couche 1) : un tournoi terminé du palmarès
// d'un joueur, en carte compacte — boule médaille (medalTone du rang final,
// rang en chiffre dedans), nom + date · équipe, badge de rang ordinal et
// ligne V/D/différentiel. Le différentiel et le libellé ordinal sont des
// calculs d'AFFICHAGE depuis le résultat stocké — aucun recalcul métier.
import type { UserTournamentResult } from '../types'
import { formatDate } from '../utils/format'

const props = defineProps<{
  result: UserTournamentResult
}>()

// Suffixe ordinal FR en exposant, comme la maquette (1ᵉʳ, 2ᵉ, 3ᵉ…).
function rankLabel(rank: number): string {
  return rank === 1 ? '1ᵉʳ' : `${rank}ᵉ`
}

const pointDifferential = computed(
  () => props.result.pointsScored - props.result.pointsConceded,
)

const pointDifferentialLabel = computed(() =>
  pointDifferential.value > 0
    ? `+${pointDifferential.value}`
    : `${pointDifferential.value}`,
)

// Même règle de couleur que la colonne DIFF du classement.
const pointDifferentialClass = computed(() =>
  pointDifferential.value >= 0 ? 'text-success' : 'text-primary',
)
</script>

<template>
  <article
    class="flex items-center gap-2.5 rounded-(--pk-r-card) bg-(--pk-card) p-3.5 shadow-(--pk-shadow-card-lg)"
  >
    <BouleAvatar :tone="medalTone(result.finalRank)" :size="40">
      <span class="text-(--pk-navy)">{{ result.finalRank }}</span>
    </BouleAvatar>

    <div class="min-w-0 flex-1">
      <h3 class="truncate font-disp text-[15px] font-bold text-(--pk-ink)">
        {{ result.tournamentName }}
      </h3>
      <p class="mt-0.5 truncate font-sans text-xs text-(--pk-muted)">
        {{ formatDate(result.tournamentDate) }} · {{ result.teamName }}
      </p>
    </div>

    <div class="flex shrink-0 flex-col items-end gap-1">
      <span
        class="rounded-full px-2 py-0.5 font-disp text-[10.5px] font-extrabold"
        :class="
          result.finalRank === 1
            ? 'bg-secondary-100 text-secondary-800'
            : 'bg-(--pk-page) text-(--pk-subtle)'
        "
      >
        {{ rankLabel(result.finalRank) }}
      </span>
      <p class="font-sans text-[11px] text-(--pk-muted) tabular-nums">
        {{ result.wins }}V · {{ result.losses }}D ·
        <span :class="pointDifferentialClass">{{
          pointDifferentialLabel
        }}</span>
      </p>
    </div>
  </article>
</template>
