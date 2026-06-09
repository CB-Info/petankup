<script setup lang="ts">
// Une entrée du journal de bord (Couche 1) : un tournoi terminé du palmarès
// d'un joueur. Badge Vainqueur / Podium, équipe + coéquipiers cliquables
// (UUser), footer compact V/D + points. Pseudo coéquipier résolu live via
// profileById (pré-hydraté par loadUserProfile), fallback snapshot.
import type { Teammate, UserTournamentResult } from '../types'
import { getTeammateDisplayName } from '../utils/team-player-display'
import { formatDate } from '../utils/format'

defineProps<{
  result: UserTournamentResult
}>()

const tournamentStore = useTournamentStore()
const { profileById } = storeToRefs(tournamentStore)

function teammateName(teammate: Teammate): string {
  return getTeammateDisplayName(teammate, profileById.value)
}

function teammateLink(teammate: Teammate): string | undefined {
  return teammate.userId !== null ? `/profile/${teammate.userId}` : undefined
}
</script>

<template>
  <UCard>
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="truncate font-semibold text-default">
          {{ result.tournamentName }}
        </p>
        <p class="text-sm text-toned">{{ formatDate(result.tournamentDate) }}</p>
      </div>
      <UBadge v-if="result.isWinner" color="primary" variant="soft">
        Vainqueur
      </UBadge>
      <UBadge v-else-if="result.isPodium" color="secondary" variant="soft">
        Podium
      </UBadge>
    </div>

    <div class="mt-3 space-y-2">
      <p class="text-sm text-toned">Équipe : {{ result.teamName }}</p>
      <ul
        v-if="result.teammates.length > 0"
        class="flex flex-wrap gap-x-4 gap-y-2"
      >
        <li
          v-for="(teammate, index) in result.teammates"
          :key="teammate.userId ?? `free-${index}`"
        >
          <UUser
            :name="teammateName(teammate)"
            :avatar="{ alt: teammateName(teammate) }"
            size="sm"
            :to="teammateLink(teammate)"
          />
        </li>
      </ul>
    </div>

    <div
      class="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted tabular-nums"
    >
      <span>Rang final : {{ result.finalRank }}</span>
      <span aria-hidden="true">·</span>
      <span>V/D : {{ result.wins }}/{{ result.losses }}</span>
      <span aria-hidden="true">·</span>
      <span>Points : {{ result.pointsScored }} - {{ result.pointsConceded }}</span>
    </div>
  </UCard>
</template>
