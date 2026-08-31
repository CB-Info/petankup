<script setup lang="ts">
// Blocs des stats globales d'un profil : Tournois / Matchs / Points, chacun
// en rangée kicker (icône + titre) puis carte en colonnes égales centrées
// (disposition de la maquette).
//
// Depuis H2.c-2, deux sources : tournois (UserStats) et matchs libres
// (UserFreeMatchStats). Les sections Matchs et Points affichent par défaut
// le TOTAL COMBINÉ, calculé à l'affichage (D3, jamais stocké) ; un toggle
// trois positions (Combiné / Tournois / Matchs libres) commute leurs
// valeurs — une source absente montre des zéros véridiques (statsForSource,
// règle testée). La section Tournois (joués / gagnés / podiums) n'a pas
// d'équivalent match libre : elle ne se combine jamais et reste fixe.
// Taux de victoire et différentiel sont dérivés à l'AFFICHAGE — aucun
// recalcul métier. Empty state si AUCUNE source n'existe.
import type { UserFreeMatchStats, UserStats } from '../types'
import { statsForSource } from '../utils/user-stats'
import type { StatsSource } from '../utils/user-stats'

const props = defineProps<{
  stats: UserStats | null
  freeMatchStats: UserFreeMatchStats | null
}>()

const hasAnyStats = computed(
  () => props.stats !== null || props.freeMatchStats !== null,
)

const statsSource = ref<StatsSource>('combined')

const STATS_SOURCE_OPTIONS: Array<{ value: StatsSource, label: string }> = [
  { value: 'combined', label: 'Combiné' },
  { value: 'tournaments', label: 'Tournois' },
  { value: 'free_matches', label: 'Matchs libres' },
]

// Les cinq compteurs affichés dans Matchs + Points, selon la position du
// toggle.
const visibleStats = computed(() =>
  statsForSource(statsSource.value, props.stats, props.freeMatchStats),
)

// Compteurs propres au tournoi : zéros véridiques pour un joueur sans
// tournoi terminé (stats null), la section reste lisible.
const tournamentCounters = computed(() => ({
  played: props.stats?.tournamentsPlayed ?? 0,
  won: props.stats?.tournamentsWon ?? 0,
  podiums: props.stats?.podiums ?? 0,
}))

const winRate = computed(() => {
  if (visibleStats.value.matchesPlayed === 0) return '0%'
  return `${Math.round((visibleStats.value.wins / visibleStats.value.matchesPlayed) * 100)}%`
})

const pointDifferentialValue = computed(
  () => visibleStats.value.pointsScored - visibleStats.value.pointsConceded,
)

const pointDifferentialLabel = computed(() =>
  pointDifferentialValue.value > 0
    ? `+${pointDifferentialValue.value}`
    : `${pointDifferentialValue.value}`,
)

// Différentiel : même règle de couleur que la colonne DIFF du classement.
const pointDifferentialClass = computed(() =>
  pointDifferentialValue.value >= 0 ? 'text-success' : 'text-primary',
)
</script>

<template>
  <p
    v-if="!hasAnyStats"
    class="py-8 text-center font-sans text-sm text-(--pk-muted)"
  >
    Aucune statistique pour l'instant.
  </p>
  <div v-else class="space-y-4">
    <section>
      <h3
        class="mb-2.25 flex items-center gap-1.5 font-disp text-[10px] font-extrabold tracking-widest uppercase text-(--pk-muted)"
      >
        <UIcon name="i-lucide-trophy" class="size-3.5 text-secondary" />
        Tournois
      </h3>
      <dl
        class="grid grid-flow-col auto-cols-fr rounded-(--pk-r-card) bg-(--pk-card) p-3.5 text-center shadow-(--pk-shadow-card-lg)"
      >
        <div>
          <dd class="font-num text-2xl font-bold text-(--pk-ink)">
            {{ tournamentCounters.played }}
          </dd>
          <dt
            class="mt-1 font-disp text-[8.5px] font-extrabold tracking-[0.06em] uppercase text-(--pk-muted)"
          >
            Joués
          </dt>
        </div>
        <div>
          <dd class="font-num text-2xl font-bold text-primary">
            {{ tournamentCounters.won }}
          </dd>
          <dt
            class="mt-1 font-disp text-[8.5px] font-extrabold tracking-[0.06em] uppercase text-(--pk-muted)"
          >
            Gagnés
          </dt>
        </div>
        <div>
          <dd class="font-num text-2xl font-bold text-(--pk-ink)">
            {{ tournamentCounters.podiums }}
          </dd>
          <dt
            class="mt-1 font-disp text-[8.5px] font-extrabold tracking-[0.06em] uppercase text-(--pk-muted)"
          >
            Podiums
          </dt>
        </div>
      </dl>
    </section>

    <!-- Détail par source : commute les valeurs des sections Matchs et
         Points, sans quitter la page. -->
    <FiltrePilules v-model="statsSource" :options="STATS_SOURCE_OPTIONS" />

    <section>
      <h3
        class="mb-2.25 flex items-center gap-1.5 font-disp text-[10px] font-extrabold tracking-widest uppercase text-(--pk-muted)"
      >
        <UIcon name="i-lucide-target" class="size-3.5 text-primary" />
        Matchs
      </h3>
      <dl
        class="grid grid-flow-col auto-cols-fr rounded-(--pk-r-card) bg-(--pk-card) p-3.5 text-center shadow-(--pk-shadow-card-lg)"
      >
        <div>
          <dd class="font-num text-2xl font-bold text-(--pk-ink)">
            {{ visibleStats.matchesPlayed }}
          </dd>
          <dt
            class="mt-1 font-disp text-[8.5px] font-extrabold tracking-[0.06em] uppercase text-(--pk-muted)"
          >
            Joués
          </dt>
        </div>
        <div>
          <dd class="font-num text-2xl font-bold text-(--pk-ink)">
            {{ visibleStats.wins }}
          </dd>
          <dt
            class="mt-1 font-disp text-[8.5px] font-extrabold tracking-[0.06em] uppercase text-(--pk-muted)"
          >
            Victoires
          </dt>
        </div>
        <div>
          <dd class="font-num text-2xl font-bold text-(--pk-ink)">
            {{ visibleStats.losses }}
          </dd>
          <dt
            class="mt-1 font-disp text-[8.5px] font-extrabold tracking-[0.06em] uppercase text-(--pk-muted)"
          >
            Défaites
          </dt>
        </div>
        <div>
          <dd class="font-num text-2xl font-bold text-success">
            {{ winRate }}
          </dd>
          <dt
            class="mt-1 font-disp text-[8.5px] font-extrabold tracking-[0.06em] uppercase text-(--pk-muted)"
          >
            Taux
          </dt>
        </div>
      </dl>
    </section>

    <section>
      <h3
        class="mb-2.25 flex items-center gap-1.5 font-disp text-[10px] font-extrabold tracking-widest uppercase text-(--pk-muted)"
      >
        <UIcon name="i-lucide-flame" class="size-3.5 text-success" />
        Points
      </h3>
      <dl
        class="grid grid-flow-col auto-cols-fr rounded-(--pk-r-card) bg-(--pk-card) p-3.5 text-center shadow-(--pk-shadow-card-lg)"
      >
        <div>
          <dd class="font-num text-2xl font-bold text-(--pk-ink)">
            {{ visibleStats.pointsScored }}
          </dd>
          <dt
            class="mt-1 font-disp text-[8.5px] font-extrabold tracking-[0.06em] uppercase text-(--pk-muted)"
          >
            Marqués
          </dt>
        </div>
        <div>
          <dd class="font-num text-2xl font-bold text-(--pk-ink)">
            {{ visibleStats.pointsConceded }}
          </dd>
          <dt
            class="mt-1 font-disp text-[8.5px] font-extrabold tracking-[0.06em] uppercase text-(--pk-muted)"
          >
            Encaissés
          </dt>
        </div>
        <div>
          <dd
            class="font-num text-2xl font-bold"
            :class="pointDifferentialClass"
          >
            {{ pointDifferentialLabel }}
          </dd>
          <dt
            class="mt-1 font-disp text-[8.5px] font-extrabold tracking-[0.06em] uppercase text-(--pk-muted)"
          >
            Différentiel
          </dt>
        </div>
      </dl>
    </section>
  </div>
</template>
