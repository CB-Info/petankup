<script setup lang="ts">
import type { Ranking, Team } from '../types'

const props = defineProps<{
  ranking: Ranking[]
  teams: Team[]
}>()

type RankingRow = {
  teamId: string
  rank: number
  teamName: string
  wins: number
  losses: number
  pointsFor: number
  pointsAgainst: number
  pointDifference: number
}

// Le ranking vient déjà trié du store (computeRanking) ; on joint
// uniquement les noms d'équipe pour l'affichage. Pas de logique
// métier ici, juste de la présentation.
const rows = computed<RankingRow[]>(() => {
  const teamNameById = new Map(props.teams.map(team => [team.id, team.name]))
  return props.ranking.map(entry => ({
    teamId: entry.teamId,
    rank: entry.rank,
    teamName: teamNameById.get(entry.teamId) ?? '—',
    wins: entry.wins,
    losses: entry.losses,
    pointsFor: entry.pointsFor,
    pointsAgainst: entry.pointsAgainst,
    pointDifference: entry.pointDifference,
  }))
})

function formatPointDifference(pointDifference: number): string {
  if (pointDifference > 0) return `+${pointDifference}`
  return String(pointDifference)
}

function rowBgClass(rank: number): string {
  if (rank === 1) return 'bg-secondary-50'
  return ''
}

function rankNumberClass(rank: number): string {
  if (rank <= 3) return 'font-semibold text-primary-900'
  return 'text-muted'
}
</script>

<template>
  <div class="space-y-2">
    <div class="overflow-hidden rounded-xl border border-default bg-elevated">
      <table class="w-full text-sm">
        <thead class="bg-elevated text-toned">
          <tr>
            <th
              scope="col"
              class="px-2 py-2 text-left font-medium"
            >
              <span class="sr-only">Position</span>#
            </th>
            <th
              scope="col"
              class="px-2 py-2 text-left font-medium"
            >
              Équipe
            </th>
            <th
              scope="col"
              class="px-2 py-2 text-right font-medium"
              title="Victoires"
            >
              V
            </th>
            <th
              scope="col"
              class="px-2 py-2 text-right font-medium"
              title="Défaites"
            >
              D
            </th>
            <th
              scope="col"
              class="px-2 py-2 text-right font-medium"
              title="Points marqués"
            >
              PM
            </th>
            <th
              scope="col"
              class="px-2 py-2 text-right font-medium"
              title="Points encaissés"
            >
              PE
            </th>
            <th
              scope="col"
              class="px-2 py-2 pr-3 text-right font-medium"
              title="Différence de points"
            >
              Diff
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.teamId"
            class="border-t border-default"
            :class="rowBgClass(row.rank)"
          >
            <td
              class="px-2 py-3 tabular-nums"
              :class="rankNumberClass(row.rank)"
            >
              {{ row.rank }}
            </td>
            <td class="px-2 py-3">
              <span class="block truncate font-medium text-primary-900">
                {{ row.teamName }}
              </span>
            </td>
            <td class="px-2 py-3 text-right tabular-nums">
              {{ row.wins }}
            </td>
            <td class="px-2 py-3 text-right tabular-nums">
              {{ row.losses }}
            </td>
            <td class="px-2 py-3 text-right tabular-nums">
              {{ row.pointsFor }}
            </td>
            <td class="px-2 py-3 text-right tabular-nums">
              {{ row.pointsAgainst }}
            </td>
            <td class="px-2 py-3 pr-3 text-right tabular-nums">
              {{ formatPointDifference(row.pointDifference) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="text-xs text-muted">
      V&nbsp;: victoires · D&nbsp;: défaites · PM&nbsp;: points marqués ·
      PE&nbsp;: points encaissés · Diff&nbsp;: différence
    </p>
  </div>
</template>
