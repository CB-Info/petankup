<script setup lang="ts">
// Pattern d'erreurs : les actions du store throw ; on attrape ici et on
// affiche un toast via useErrorToast (voir composables/useErrorToast).
import type { Ranking, Team } from "../../../types";

const route = useRoute();
const tournamentStore = useTournamentStore();
const { currentTournament, teams, matches, ranking } =
  storeToRefs(tournamentStore);
const { showError } = useErrorToast();

const tournamentId = computed(() => route.params.tournamentId as string);

// Chargement fire-and-forget dès le setup. On évite un load inutile si on
// arrive d'un NuxtLink où le tournoi courant est déjà le bon. Le template
// gère l'état vide (currentTournament null) pendant que la promesse
// se résout côté Supabase.
const tournamentNeedsLoading =
  currentTournament.value === null ||
  currentTournament.value.id !== tournamentId.value;
if (tournamentNeedsLoading) {
  tournamentStore.loadTournament(tournamentId.value).catch(showError);
}

const tournamentIsCompleted = computed(
  () => currentTournament.value?.status === "completed",
);

const completedMatchCount = computed(
  () => matches.value.filter((match) => match.status === "completed").length,
);

// Le podium n'a de sens que sur le tournoi terminé : on borne à
// 3 max mais on s'adapte si le tournoi n'a que 1 ou 2 équipes.
type PodiumEntry = { rank: number; team: Team; ranking: Ranking };

const podiumEntries = computed<PodiumEntry[]>(() => {
  const teamById = new Map(teams.value.map((team) => [team.id, team]));
  const topThreeRankings = ranking.value.slice(0, 3);
  const entries: PodiumEntry[] = [];
  for (const rankingEntry of topThreeRankings) {
    const team = teamById.get(rankingEntry.teamId);
    if (team) {
      entries.push({ rank: rankingEntry.rank, team, ranking: rankingEntry });
    }
  }
  return entries;
});

// Disposition podium classique : 2e à gauche, 1er au centre,
// 3e à droite — on construit donc une liste ordonnée pour
// l'affichage (≠ ordre du classement).
const podiumDisplayOrder = computed<PodiumEntry[]>(() => {
  const ordered: PodiumEntry[] = [];
  const second = podiumEntries.value.find((entry) => entry.rank === 2);
  const first = podiumEntries.value.find((entry) => entry.rank === 1);
  const third = podiumEntries.value.find((entry) => entry.rank === 3);
  if (second) ordered.push(second);
  if (first) ordered.push(first);
  if (third) ordered.push(third);
  return ordered;
});

// Hauteurs différenciées des marches via padding vertical — pas de
// hauteur fixe pour rester adaptatif aux noms longs.
function stepBgClass(rank: number): string {
  if (rank === 1) return "bg-secondary-50 border-secondary-200";
  return "bg-elevated border-default";
}

function stepPaddingClass(rank: number): string {
  if (rank === 1) return "pt-8 pb-10";
  if (rank === 2) return "pt-6 pb-7";
  return "pt-5 pb-5";
}

function rankNumberSizeClass(rank: number): string {
  if (rank === 1) return "text-5xl font-bold text-primary-900";
  return "text-3xl font-semibold text-primary-900";
}

function teamNameWeightClass(rank: number): string {
  if (rank === 1) return "font-semibold text-primary-900";
  return "font-medium text-primary-900";
}

useHead(() => ({
  title: currentTournament.value
    ? `Résultats — ${currentTournament.value.name}`
    : "Résultats — Pétankup",
}));
</script>

<template>
  <div v-if="!currentTournament" class="space-y-4 py-12 text-center">
    <h1 class="text-xl font-semibold text-primary-900">Tournoi introuvable</h1>
    <UButton to="/" variant="ghost" color="neutral" icon="i-lucide-arrow-left">
      Retour à l'accueil
    </UButton>
  </div>

  <div v-else-if="!tournamentIsCompleted" class="space-y-4 py-12 text-center">
    <h1 class="text-xl font-semibold text-primary-900">
      Ce tournoi n'est pas encore terminé
    </h1>
    <p class="text-sm text-toned">
      Les résultats seront disponibles une fois le tournoi terminé.
    </p>
    <UButton
      :to="`/tournaments/${tournamentId}`"
      variant="ghost"
      color="neutral"
      icon="i-lucide-arrow-left"
    >
      Retour au tournoi
    </UButton>
  </div>

  <div v-else class="space-y-8">
    <div class="space-y-3">
      <UButton
        :to="`/tournaments/${tournamentId}`"
        variant="ghost"
        color="neutral"
        icon="i-lucide-arrow-left"
        size="sm"
      >
        Retour au tournoi
      </UButton>
      <div class="space-y-1">
        <p
          class="text-xs font-semibold uppercase tracking-[0.08em] text-toned"
        >
          Résultats
        </p>
        <h1 class="truncate text-2xl font-semibold text-primary-900">
          {{ currentTournament.name }}
        </h1>
        <p class="text-sm text-toned">
          {{ formatDate(currentTournament.date) }}
          <template v-if="currentTournament.location">
            · {{ currentTournament.location }}
          </template>
        </p>
      </div>
    </div>

    <section aria-label="Podium" class="space-y-4">
      <div class="flex items-end justify-center gap-2 sm:gap-3">
        <div
          v-for="entry in podiumDisplayOrder"
          :key="entry.team.id"
          class="flex-1 rounded-xl border px-3 text-center"
          :class="[stepBgClass(entry.rank), stepPaddingClass(entry.rank)]"
        >
          <p
            class="tabular-nums leading-none"
            :class="rankNumberSizeClass(entry.rank)"
          >
            {{ entry.rank }}
          </p>
          <p
            class="mt-3 truncate text-sm sm:text-base"
            :class="teamNameWeightClass(entry.rank)"
          >
            {{ entry.team.name }}
          </p>
          <p
            v-if="entry.team.players.length > 0"
            class="mt-1 line-clamp-2 text-xs text-toned sm:text-sm"
          >
            {{ entry.team.players.join(" · ") }}
          </p>
        </div>
      </div>
    </section>

    <section aria-label="Récapitulatif" class="space-y-3">
      <h2
        class="text-xs font-semibold uppercase tracking-[0.08em] text-toned"
      >
        Récapitulatif
      </h2>
      <UCard>
        <dl class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div>
            <dt class="text-toned">Date</dt>
            <dd class="font-medium text-primary-900">
              {{ formatDate(currentTournament.date) }}
            </dd>
          </div>
          <div v-if="currentTournament.location">
            <dt class="text-toned">Lieu</dt>
            <dd class="truncate font-medium text-primary-900">
              {{ currentTournament.location }}
            </dd>
          </div>
          <div>
            <dt class="text-toned">Équipes</dt>
            <dd class="font-medium tabular-nums text-primary-900">
              {{ teams.length }}
            </dd>
          </div>
          <div>
            <dt class="text-toned">Matchs joués</dt>
            <dd class="font-medium tabular-nums text-primary-900">
              {{ completedMatchCount }}
            </dd>
          </div>
        </dl>
      </UCard>
    </section>

    <section aria-label="Classement final" class="space-y-3">
      <h2
        class="text-xs font-semibold uppercase tracking-[0.08em] text-toned"
      >
        Classement final
      </h2>
      <RankingTable :ranking="ranking" :teams="teams" />
    </section>

    <p
      class="border-t border-default pt-6 text-center text-xs text-muted"
    >
      Bientôt&nbsp;: partagez les résultats avec vos amis.
    </p>
  </div>
</template>
