<script setup lang="ts">
import type { TournamentStatus } from "../types";

const tournamentStore = useTournamentStore();
const { tournaments } = storeToRefs(tournamentStore);

onMounted(() => {
  tournamentStore.loadTournaments();
});

// Ordre d'affichage : en cours d'abord (ce qui se passe maintenant),
// puis brouillons (à finir de préparer), puis terminés (archivés).
const STATUS_DISPLAY_ORDER: Record<TournamentStatus, number> = {
  in_progress: 0,
  draft: 1,
  completed: 2,
};

const sortedTournaments = computed(() => {
  return [...tournaments.value].sort((firstTournament, secondTournament) => {
    const statusDiff =
      STATUS_DISPLAY_ORDER[firstTournament.status] -
      STATUS_DISPLAY_ORDER[secondTournament.status];
    if (statusDiff !== 0) return statusDiff;
    // Date desc : la plus récente en premier (les ISO se comparent comme du texte).
    return secondTournament.date.localeCompare(firstTournament.date);
  });
});

function statusLabel(status: TournamentStatus): string {
  switch (status) {
    case "draft":
      return "Brouillon";
    case "in_progress":
      return "En cours";
    case "completed":
      return "Terminé";
  }
}

type BadgeColor = "primary" | "secondary" | "success";

function statusBadgeColor(status: TournamentStatus): BadgeColor {
  switch (status) {
    case "in_progress":
      return "primary";
    case "draft":
      return "secondary";
    case "completed":
      return "success";
  }
}

useHead({ title: "Pétankup — Gestion de tournois" });
</script>

<template>
  <div>
    <div v-if="tournaments.length === 0" class="py-16 text-center">
      <h2 class="text-lg font-semibold text-primary-900">
        Aucun tournoi pour l'instant
      </h2>
      <p class="mt-2 text-toned">Créez votre premier tournoi de pétanque</p>
      <UButton
        to="/tournaments/new"
        color="primary"
        size="lg"
        class="mt-6"
        block
      >
        Créer un tournoi
      </UButton>
    </div>

    <div v-else class="space-y-4">
      <UButton to="/tournaments/new" color="primary" size="lg" block>
        Créer un tournoi
      </UButton>

      <ul class="space-y-3">
        <li v-for="tournament in sortedTournaments" :key="tournament.id">
          <NuxtLink :to="`/tournaments/${tournament.id}`" class="block">
            <UCard>
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 space-y-1">
                  <h3 class="truncate font-semibold text-primary-900">
                    {{ tournament.name }}
                  </h3>
                  <p class="text-sm text-toned">
                    {{ formatDate(tournament.date) }}
                  </p>
                  <p
                    v-if="tournament.location"
                    class="truncate text-sm text-toned"
                  >
                    {{ tournament.location }}
                  </p>
                </div>
                <UBadge
                  :color="statusBadgeColor(tournament.status)"
                  variant="soft"
                >
                  {{ statusLabel(tournament.status) }}
                </UBadge>
              </div>
            </UCard>
          </NuxtLink>
        </li>
      </ul>
    </div>
  </div>
</template>
