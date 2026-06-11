<script setup lang="ts">
import type { TournamentStatus } from "../types";

// Ligne d'un tournoi dans la liste de l'accueil : liséré coloré gauche (selon
// statut), nom, sous-info, label statut à droite (StatutBadge variant liste).
// Plus de boule sur cette carte (évolution de design). Purement
// présentationnel : la sous-info (date · lieu, ou « En cours · 3/6 matchs »)
// est composée par l'écran. Conteneur <article> stylé — UCard impose ses
// slots/padding et ne couvre pas le liséré pleine hauteur (audit acté).

const props = defineProps<{
  name: string;
  subInfo: string;
  status: TournamentStatus;
}>();

// Liséré gauche : mêmes couleurs de statut que StatutBadge en liste
// (terminé = vert, brouillon = doré, en cours = corail).
const SPINE_COLOR_CLASS: Record<TournamentStatus, string> = {
  draft: "bg-secondary",
  in_progress: "bg-primary",
  completed: "bg-success",
};

const spineClass = computed(() => SPINE_COLOR_CLASS[props.status]);
</script>

<template>
  <article
    class="flex overflow-hidden rounded-(--pk-r-card) border border-(--pk-line) bg-(--pk-card) shadow-(--pk-shadow-card-lg)"
  >
    <span class="w-1.25 shrink-0" :class="spineClass" />

    <div class="flex flex-1 items-center gap-3 px-4 py-3.5">
      <div class="min-w-0 flex-1">
        <h3
          class="truncate font-disp text-[16.5px] font-bold tracking-[-0.01em] text-(--pk-ink)"
        >
          {{ name }}
        </h3>
        <p class="mt-0.5 truncate font-sans text-[12.5px] text-(--pk-muted)">
          {{ subInfo }}
        </p>
      </div>

      <StatutBadge :statut="status" variant="liste" class="shrink-0" />
    </div>
  </article>
</template>
