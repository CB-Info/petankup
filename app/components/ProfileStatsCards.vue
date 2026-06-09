<script setup lang="ts">
// Bloc des stats globales d'un profil (Couche 2). Trois cards Tournois /
// Matchs / Points. Taux de victoire et différentiel sont dérivés à
// l'affichage (non stockés en DB, cf. cadrage Phase J). Empty state si le
// joueur n'a aucun tournoi terminé (stats null).
import type { UserStats } from '../types'

const props = defineProps<{
  stats: UserStats | null
}>()

const winRate = computed(() => {
  if (props.stats === null || props.stats.matchesPlayed === 0) return '—'
  return `${Math.round((props.stats.wins / props.stats.matchesPlayed) * 100)}%`
})

const pointDifferential = computed(() => {
  if (props.stats === null) return ''
  const differential = props.stats.pointsScored - props.stats.pointsConceded
  return differential > 0 ? `+${differential}` : `${differential}`
})
</script>

<template>
  <p v-if="stats === null" class="py-8 text-center text-sm text-muted">
    Aucun tournoi terminé pour l'instant.
  </p>
  <div v-else class="grid grid-cols-1 gap-4 md:grid-cols-3">
    <UCard>
      <p class="text-sm uppercase text-muted">Tournois</p>
      <dl class="mt-2 space-y-1 text-sm tabular-nums">
        <div class="flex items-center justify-between">
          <dt class="text-toned">Joués</dt>
          <dd class="font-semibold text-default">{{ stats.tournamentsPlayed }}</dd>
        </div>
        <div class="flex items-center justify-between">
          <dt class="text-toned">Gagnés</dt>
          <dd class="font-semibold text-default">{{ stats.tournamentsWon }}</dd>
        </div>
        <div class="flex items-center justify-between">
          <dt class="text-toned">Podiums</dt>
          <dd class="font-semibold text-default">{{ stats.podiums }}</dd>
        </div>
      </dl>
    </UCard>

    <UCard>
      <p class="text-sm uppercase text-muted">Matchs</p>
      <dl class="mt-2 space-y-1 text-sm tabular-nums">
        <div class="flex items-center justify-between">
          <dt class="text-toned">Joués</dt>
          <dd class="font-semibold text-default">{{ stats.matchesPlayed }}</dd>
        </div>
        <div class="flex items-center justify-between">
          <dt class="text-toned">Victoires</dt>
          <dd class="font-semibold text-default">{{ stats.wins }}</dd>
        </div>
        <div class="flex items-center justify-between">
          <dt class="text-toned">Défaites</dt>
          <dd class="font-semibold text-default">{{ stats.losses }}</dd>
        </div>
        <div class="flex items-center justify-between">
          <dt class="text-toned">Taux de victoire</dt>
          <dd class="font-semibold text-default">{{ winRate }}</dd>
        </div>
      </dl>
    </UCard>

    <UCard>
      <p class="text-sm uppercase text-muted">Points</p>
      <dl class="mt-2 space-y-1 text-sm tabular-nums">
        <div class="flex items-center justify-between">
          <dt class="text-toned">Marqués</dt>
          <dd class="font-semibold text-default">{{ stats.pointsScored }}</dd>
        </div>
        <div class="flex items-center justify-between">
          <dt class="text-toned">Encaissés</dt>
          <dd class="font-semibold text-default">{{ stats.pointsConceded }}</dd>
        </div>
        <div class="flex items-center justify-between">
          <dt class="text-toned">Différentiel</dt>
          <dd class="font-semibold text-default">{{ pointDifferential }}</dd>
        </div>
      </dl>
    </UCard>
  </div>
</template>
