<script setup lang="ts">
import type { TournamentStatus } from "../types";

// Statut de tournoi, valeurs exactes Direction C (Claude Design). Span
// sémantique épuré — pas de UBadge (aucun variant `ghost`, toutes ses variantes
// portent une chrome). Deux presets via `variant` :
//
// - header : dans les en-têtes navy. La puce n'est PAS un élément séparé : c'est
//   le glyphe ● (U+25CF) intégré au début du label, même couleur que le texte.
//   Couleur TOUJOURS or (`text-secondary` = #E2B45A) quel que soit le statut.
// - liste : sur les cartes de la liste de tournois. Label seul (sans glyphe),
//   couleur selon le statut.
//
// Police Archivo (`font-disp`), poids 800 (`font-extrabold`). `live` bascule le
// label in_progress en « En direct » (header uniquement). Toutes les couleurs
// passent par un token du socle (aucun hex nu).
type StatutVariant = "header" | "liste";

const props = withDefaults(
  defineProps<{
    statut: TournamentStatus;
    variant?: StatutVariant;
    live?: boolean;
  }>(),
  {
    variant: "header",
    live: false,
  },
);

const BASE_LABELS: Record<TournamentStatus, string> = {
  draft: "Brouillon",
  in_progress: "En cours",
  completed: "Terminé",
};

// Couleur du label en mode liste (lisible sur crème). En mode header la couleur
// est toujours `text-secondary`, indépendamment du statut.
const LISTE_COLOR_CLASS: Record<TournamentStatus, string> = {
  draft: "text-secondary-700", // or foncé #B98A2E
  in_progress: "text-primary", // corail (cohérent ; hors maquette en liste)
  completed: "text-success", // vert #2F7D5E
};

const isHeader = computed(() => props.variant === "header");

const baseLabel = computed(() =>
  isHeader.value && props.statut === "in_progress" && props.live
    ? "En direct"
    : BASE_LABELS[props.statut],
);

// header : glyphe ● + label, capitales via CSS `uppercase`.
// liste  : label seul, déjà en capitales (toUpperCase, pas de text-transform).
const displayLabel = computed(() =>
  isHeader.value ? `● ${baseLabel.value}` : baseLabel.value.toUpperCase(),
);

const spanClass = computed(() =>
  isHeader.value
    ? "font-disp text-[11px] font-extrabold tracking-[0.14em] uppercase text-secondary"
    : [
        "font-disp text-[10px] font-extrabold tracking-[0.08em]",
        LISTE_COLOR_CLASS[props.statut],
      ],
);
</script>

<template>
  <span :class="spanClass">{{ displayLabel }}</span>
</template>
