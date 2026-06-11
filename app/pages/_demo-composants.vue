<!-- DEMO TEMPORAIRE — à supprimer en fin de lot composants (ticket de cleanup) -->
<script setup lang="ts">
import type { TournamentStatus } from '../types'

// Page de validation isolée des briques de base (BouleAvatar, StatutBadge).
// Non liée dans la navigation. Accès en étant connecté (redirect auth global).

const TONES = [
  'horizon',
  'sand',
  'gold',
  'silver',
  'bronze',
  'clay',
  'dark',
] as const

const SIZES = [40, 60, 96]

const STATUTS: { statut: TournamentStatus; live?: boolean; titre: string }[] = [
  { statut: 'draft', titre: 'Brouillon' },
  { statut: 'in_progress', titre: 'En cours' },
  { statut: 'in_progress', live: true, titre: 'En direct (live)' },
  { statut: 'completed', titre: 'Terminé' },
]

// Un panneau par variant : header sur le navy du header, liste sur la crème
// des cartes. La couleur (toujours or en header, par statut en liste) doit
// tenir sur son fond.
const PANELS = [
  {
    titre: 'Variant header — sur navy',
    variant: 'header' as const,
    panelClass: 'bg-(--pk-navy)',
    captionClass: 'text-(--pk-on-navy-2)',
  },
  {
    titre: 'Variant liste — sur crème',
    variant: 'liste' as const,
    panelClass: 'bg-elevated',
    captionClass: 'text-toned',
  },
]
</script>

<template>
  <div class="space-y-10">
    <header>
      <p class="font-disp text-xs tracking-widest text-muted uppercase">
        Démo temporaire
      </p>
      <h1 class="font-disp text-2xl font-bold text-default">
        Composants de base
      </h1>
    </header>

    <!-- BouleAvatar : 7 tons × tailles, avec striures -->
    <section class="space-y-4">
      <h2 class="font-disp text-lg font-semibold text-default">
        BouleAvatar — tons et tailles (avec striures)
      </h2>
      <div class="space-y-6">
        <div
          v-for="size in SIZES"
          :key="size"
          class="flex flex-wrap items-end gap-5"
        >
          <div
            v-for="tone in TONES"
            :key="tone"
            class="flex flex-col items-center gap-2"
          >
            <BouleAvatar :tone="tone" :size="size" />
            <span class="text-xs text-toned">{{ tone }} · {{ size }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- BouleAvatar : sans striures -->
    <section class="space-y-4">
      <h2 class="font-disp text-lg font-semibold text-default">
        BouleAvatar — sans striures (striped=false)
      </h2>
      <div class="flex flex-wrap items-end gap-5">
        <div
          v-for="tone in TONES"
          :key="tone"
          class="flex flex-col items-center gap-2"
        >
          <BouleAvatar :tone="tone" :size="60" :striped="false" />
          <span class="text-xs text-toned">{{ tone }}</span>
        </div>
      </div>
    </section>

    <!-- BouleAvatar : initiale via slot -->
    <section class="space-y-4">
      <h2 class="font-disp text-lg font-semibold text-default">
        BouleAvatar — initiale (slot), façon « Mon compte »
      </h2>
      <BouleAvatar tone="gold" :size="96" aria-label="Profil de Bilfngr">
        <span class="text-(--pk-navy)">B</span>
      </BouleAvatar>
    </section>

    <!-- StatutBadge : variant header (navy) vs variant liste (crème) -->
    <section class="space-y-4">
      <h2 class="font-disp text-lg font-semibold text-default">
        StatutBadge — header (navy) et liste (crème)
      </h2>
      <div class="grid gap-4 sm:grid-cols-2">
        <div
          v-for="panel in PANELS"
          :key="panel.titre"
          class="space-y-3 rounded-xl p-4"
          :class="panel.panelClass"
        >
          <p class="text-xs tracking-wide uppercase" :class="panel.captionClass">
            {{ panel.titre }}
          </p>
          <div class="flex flex-wrap items-center gap-x-5 gap-y-3">
            <div
              v-for="entry in STATUTS"
              v-show="!(entry.live && panel.variant === 'liste')"
              :key="entry.titre"
              class="flex flex-col items-start gap-1.5"
            >
              <StatutBadge :statut="entry.statut" :variant="panel.variant" :live="entry.live" />
              <span class="text-[11px]" :class="panel.captionClass">{{ entry.titre }}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
