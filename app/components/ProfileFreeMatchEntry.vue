<script setup lang="ts">
// Une entrée de match libre du journal de bord : carte sœur de
// ProfileJournalEntry (même coquille, même densité, sans en être une
// copie) — boule V/D et pastille Gagné/Perdu (l'issue se lit d'un coup
// d'œil), date + format, lignes « contre … » et « avec … », score du point
// de vue du joueur. Tous les calculs sont d'AFFICHAGE depuis l'entrée du
// bundle — l'issue vient de freeMatchOutcomeOf (règle testée), jamais
// recalculée ici.
//
// `teammateNames` / `opponentNames` : noms déjà résolus par la page
// (pseudo live ou snapshot) — texte simple, jamais de lien : la carte
// entière peut être un lien vers le match, pas de cible imbriquée. Une
// entrée non ouvrable arrive avec des listes vides (la base ne divulgue
// pas les participants d'un match privé) → aucune ligne, aucun libellé
// vide, et le format est inconnu (la date, le score et l'issue restent).
// `interactive` : chevron d'affordance quand la page enveloppe d'un lien.
import type { UserFreeMatchResult } from '../types'
import {
  FREE_MATCH_FORMAT_LABELS,
  freeMatchFormatForSideCount,
  freeMatchOutcomeOf,
} from '../utils/free-match'
import { formatDate } from '../utils/format'
import { formatOpponentsLine, formatTeammatesLine } from '../utils/team-player-display'

const props = withDefaults(
  defineProps<{
    freeMatch: UserFreeMatchResult
    teammateNames?: string[]
    opponentNames?: string[]
    interactive?: boolean
  }>(),
  {
    teammateNames: () => [],
    opponentNames: () => [],
    interactive: false,
  },
)

const outcome = computed(() => freeMatchOutcomeOf(props.freeMatch))

// « … · Doublette » quand l'effectif est connu (opponents = un camp
// complet) ; rien quand l'entrée n'est pas ouvrable (listes vidées).
const metaLine = computed(() => {
  const format = freeMatchFormatForSideCount(props.freeMatch.opponents.length)
  const dateLabel = formatDate(props.freeMatch.playedOn)
  return format === null
    ? dateLabel
    : `${dateLabel} · ${FREE_MATCH_FORMAT_LABELS[format]}`
})

const opponentsLine = computed(() => formatOpponentsLine(props.opponentNames))
const teammatesLine = computed(() => formatTeammatesLine(props.teammateNames))

// Score du point de vue du joueur consulté : ses points d'abord.
const scoreline = computed(
  () => `${outcome.value.pointsScored} – ${outcome.value.pointsConceded}`,
)
</script>

<template>
  <article
    class="flex items-center gap-2.5 rounded-(--pk-r-card) bg-(--pk-card) p-3.5 shadow-(--pk-shadow-card-lg)"
  >
    <BouleAvatar :tone="outcome.won ? 'gold' : 'horizon'" :size="40">
      <span class="text-(--pk-navy)">{{ outcome.won ? 'V' : 'D' }}</span>
    </BouleAvatar>

    <div class="min-w-0 flex-1">
      <h3 class="truncate font-disp text-[15px] font-bold text-(--pk-ink)">
        Match libre
      </h3>
      <p class="mt-0.5 truncate font-sans text-xs text-(--pk-muted)">
        {{ metaLine }}
      </p>
      <p
        v-if="opponentsLine"
        class="mt-0.5 truncate font-sans text-xs text-(--pk-muted)"
      >
        {{ opponentsLine }}
      </p>
      <p
        v-if="teammatesLine"
        class="mt-0.5 truncate font-sans text-xs text-(--pk-muted)"
      >
        {{ teammatesLine }}
      </p>
    </div>

    <div class="flex shrink-0 flex-col items-end gap-1">
      <span
        class="rounded-full px-2 py-0.5 font-disp text-[10.5px] font-extrabold"
        :class="
          outcome.won
            ? 'bg-success-100 text-success-800'
            : 'bg-(--pk-page) text-(--pk-subtle)'
        "
      >
        {{ outcome.won ? 'Gagné' : 'Perdu' }}
      </span>
      <p class="font-sans text-[11px] text-(--pk-muted) tabular-nums">
        {{ scoreline }}
      </p>
    </div>

    <UIcon
      v-if="interactive"
      name="i-lucide-chevron-right"
      class="size-4 shrink-0 text-(--pk-muted)"
    />
  </article>
</template>
