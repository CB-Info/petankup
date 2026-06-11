<script setup lang="ts">
import type { TournamentStatus } from '../types'
import type { BouleTone } from './BouleAvatar.vue'

// Ligne d'un tournoi dans la liste de l'accueil : liséré coloré gauche (selon
// statut), boule, nom, sous-info, label statut à droite. Assemble BouleAvatar
// et StatutBadge (variant liste) du lot 1. Purement présentationnel : le tone
// de la boule et la sous-info (date · lieu) sont composés par l'écran.
// Conteneur <article> stylé — UCard impose ses slots/padding et ne couvre pas
// le liséré pleine hauteur (audit acté en plan).

const props = withDefaults(
  defineProps<{
    name: string
    subInfo: string
    status: TournamentStatus
    tone?: BouleTone
  }>(),
  {
    tone: 'horizon',
  },
)

// Liséré gauche : mêmes couleurs de statut que StatutBadge en liste
// (terminé = vert, brouillon = doré, en cours = corail).
const SPINE_COLOR_CLASS: Record<TournamentStatus, string> = {
  draft: 'bg-secondary',
  in_progress: 'bg-primary',
  completed: 'bg-success',
}

const spineClass = computed(() => SPINE_COLOR_CLASS[props.status])
</script>

<template>
  <article
    class="flex overflow-hidden rounded-(--pk-r-card) border border-(--pk-line) bg-(--pk-card) shadow-(--pk-shadow-card-lg)"
  >
    <span class="w-[5px] shrink-0" :class="spineClass" />

    <div class="flex flex-1 items-center gap-[13px] py-3.5 pr-[15px] pl-[15px]">
      <BouleAvatar :tone="tone" :size="40" />

      <div class="min-w-0 flex-1">
        <h3
          class="truncate font-disp text-[16.5px] font-bold tracking-[-0.01em] text-(--pk-ink)"
        >
          {{ name }}
        </h3>
        <p class="mt-0.5 font-sans text-[12.5px] text-(--pk-muted)">
          {{ subInfo }}
        </p>
      </div>

      <StatutBadge :statut="status" variant="liste" />
    </div>
  </article>
</template>
