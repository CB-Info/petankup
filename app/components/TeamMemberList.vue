<script setup lang="ts">
// Liste des joueurs d'une équipe en blocs UUser. Remplace l'ancien
// formatTeamPlayers (texte joint) : un joueur lié à un compte est cliquable
// vers son profil (prop `to`), un joueur libre (userId null) ne l'est pas.
// Pseudo live via profileById (cache store), fallback snapshot.
import type { TeamPlayer } from '../types'
import { getPlayerDisplayName } from '../utils/team-player-display'

withDefaults(
  defineProps<{
    players: TeamPlayer[]
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  }>(),
  { size: 'sm' },
)

const tournamentStore = useTournamentStore()
const { profileById } = storeToRefs(tournamentStore)

function nameFor(player: TeamPlayer): string {
  return getPlayerDisplayName(player, profileById.value)
}

function linkFor(player: TeamPlayer): string | undefined {
  return player.userId !== null ? `/profile/${player.userId}` : undefined
}
</script>

<template>
  <ul class="flex flex-wrap gap-x-4 gap-y-2">
    <li v-for="player in players" :key="player.id">
      <UUser
        :name="nameFor(player)"
        :avatar="{ alt: nameFor(player) }"
        :size="size"
        :to="linkFor(player)"
      />
    </li>
  </ul>
</template>
