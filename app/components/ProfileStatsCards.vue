<script setup lang="ts">
// Blocs des stats globales d'un profil (Couche 2) : Tournois / Matchs /
// Points, chacun en rangée kicker (icône + titre) puis carte en colonnes
// égales centrées (disposition de la maquette). Taux de victoire et
// différentiel sont dérivés à l'AFFICHAGE depuis le bundle (non stockés
// en DB, cf. cadrage Phase J) — aucun recalcul métier. Empty state si le
// joueur n'a aucun tournoi terminé (stats null).
import type { UserStats } from '../types'

const props = defineProps<{
  stats: UserStats | null
}>()

const winRate = computed(() => {
  if (props.stats === null || props.stats.matchesPlayed === 0) return '0%'
  return `${Math.round((props.stats.wins / props.stats.matchesPlayed) * 100)}%`
})

const pointDifferentialValue = computed(() =>
  props.stats === null
    ? 0
    : props.stats.pointsScored - props.stats.pointsConceded,
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
    v-if="stats === null"
    class="py-8 text-center font-sans text-sm text-(--pk-muted)"
  >
    Aucun tournoi terminé pour l'instant.
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
            {{ stats.tournamentsPlayed }}
          </dd>
          <dt
            class="mt-1 font-disp text-[8.5px] font-extrabold tracking-[0.06em] uppercase text-(--pk-muted)"
          >
            Joués
          </dt>
        </div>
        <div>
          <dd class="font-num text-2xl font-bold text-primary">
            {{ stats.tournamentsWon }}
          </dd>
          <dt
            class="mt-1 font-disp text-[8.5px] font-extrabold tracking-[0.06em] uppercase text-(--pk-muted)"
          >
            Gagnés
          </dt>
        </div>
        <div>
          <dd class="font-num text-2xl font-bold text-(--pk-ink)">
            {{ stats.podiums }}
          </dd>
          <dt
            class="mt-1 font-disp text-[8.5px] font-extrabold tracking-[0.06em] uppercase text-(--pk-muted)"
          >
            Podiums
          </dt>
        </div>
      </dl>
    </section>

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
            {{ stats.matchesPlayed }}
          </dd>
          <dt
            class="mt-1 font-disp text-[8.5px] font-extrabold tracking-[0.06em] uppercase text-(--pk-muted)"
          >
            Joués
          </dt>
        </div>
        <div>
          <dd class="font-num text-2xl font-bold text-(--pk-ink)">
            {{ stats.wins }}
          </dd>
          <dt
            class="mt-1 font-disp text-[8.5px] font-extrabold tracking-[0.06em] uppercase text-(--pk-muted)"
          >
            Victoires
          </dt>
        </div>
        <div>
          <dd class="font-num text-2xl font-bold text-(--pk-ink)">
            {{ stats.losses }}
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
            {{ stats.pointsScored }}
          </dd>
          <dt
            class="mt-1 font-disp text-[8.5px] font-extrabold tracking-[0.06em] uppercase text-(--pk-muted)"
          >
            Marqués
          </dt>
        </div>
        <div>
          <dd class="font-num text-2xl font-bold text-(--pk-ink)">
            {{ stats.pointsConceded }}
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
