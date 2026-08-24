<script setup lang="ts">
// Pattern d'erreurs : les actions du store throw ; on attrape ici et on
// affiche un toast via useErrorToast (voir composables/useErrorToast).
//
// Écran « célébration » : fond navy plein écran (--pk-grad-podium), à la
// différence des écrans crème. Layout désactivé ; pas d'AppHeader (une
// bande navy sur fond navy serait invisible) — simple lien retour.
import type { Ranking, Team } from "../../../types";

definePageMeta({ layout: false });

const route = useRoute();
const tournamentStore = useTournamentStore();
const { currentTournament, teams, matches, ranking } =
  storeToRefs(tournamentStore);
const { showError } = useErrorToast();

const tournamentId = computed(() => route.params.tournamentId as string);

const isLoadingDetail = ref(true);

// Token local pour invalider un flip tardif de isLoadingDetail si une
// nouvelle requête a démarré entre-temps. Cf. la page détail pour le
// pattern complet.
let loadDetailRequestId = 0;

watch(
  tournamentId,
  async (id) => {
    // Court-circuit : si on arrive depuis la page détail du même
    // tournoi, le store a déjà currentTournament + teams + matches
    // pour cet id. Pas de reload, pas de flash "Chargement…".
    // Si l'id change vraiment, le test est faux et on enchaîne sur
    // le chemin normal (clear-at-start côté store + token).
    if (currentTournament.value?.id === id) {
      isLoadingDetail.value = false;
      return;
    }
    const requestId = ++loadDetailRequestId;
    isLoadingDetail.value = true;
    try {
      await tournamentStore.loadTournament(id);
    } catch (error) {
      if (requestId === loadDetailRequestId) showError(error);
    } finally {
      if (requestId === loadDetailRequestId) {
        isLoadingDetail.value = false;
      }
    }
  },
  { immediate: true },
);

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

// ── Re-sélections de PRÉSENTATION depuis les computeds existants : le
// champion en hero, les 2e/3e en cartes. Aucun recalcul de classement.

const championEntry = computed(
  () => podiumEntries.value.find((entry) => entry.rank === 1) ?? null,
);

const runnersUp = computed(() =>
  podiumDisplayOrder.value.filter((entry) => entry.rank !== 1),
);

// Nombre de manches jouées (footer) : manches distinctes des matchs déjà
// chargés — calcul d'affichage, pas une règle métier.
const roundCount = computed(
  () => new Set(matches.value.map((match) => match.roundNumber)).size,
);

// Diff signé pour l'affichage : "+12", "-4", "0" (le signe moins vient
// du nombre lui-même).
function signedDiff(pointDifference: number): string {
  return pointDifference > 0 ? `+${pointDifference}` : `${pointDifference}`;
}

const championDiffLabel = computed(() => {
  if (!championEntry.value) return "";
  return signedDiff(championEntry.value.ranking.pointDifference);
});

// Couleur matière du numéro de rang des cartes : argent pour #2, bronze
// pour #3 — stops 34 % des dégradés silver/bronze de BouleAvatar (hex
// locaux assumés, comme les TONE_GRADIENTS).
const RUNNER_UP_RANK_COLOR_CLASS: Record<number, string> = {
  2: "text-[#D2CEC4]",
  3: "text-[#C78A5C]",
};

// Libellés pluriels des badges du champion (affichage).
const championWinsLabel = computed(() => {
  if (!championEntry.value) return "";
  const wins = championEntry.value.ranking.wins;
  return `${wins} ${wins > 1 ? "victoires" : "victoire"}`;
});

const championLossesLabel = computed(() => {
  if (!championEntry.value) return "";
  const losses = championEntry.value.ranking.losses;
  return `${losses} ${losses > 1 ? "défaites" : "défaite"}`;
});

useHead(() => ({
  title: currentTournament.value
    ? `Résultats — ${currentTournament.value.name}`
    : "Résultats — Pétankup",
}));
</script>

<template>
  <div
    class="min-h-screen [background:var(--pk-grad-podium)] text-(--pk-cream)"
  >
    <div class="mx-auto max-w-2xl px-4.5 pt-[env(safe-area-inset-top)] pb-10">
      <p
        v-if="isLoadingDetail"
        class="py-16 text-center font-sans text-sm text-(--pk-on-navy-2)"
      >
        Chargement du tournoi…
      </p>

      <!-- Garde finale : on n'affiche le contenu que si le tournoi en
           mémoire correspond à l'id de route. La forme inline (vs un
           computed booléen) permet à volar de narrower currentTournament
           à non-null dans les v-else suivants. -->
      <div
        v-else-if="!currentTournament || currentTournament.id !== tournamentId"
        class="flex flex-col items-center gap-3 py-16 text-center"
      >
        <h1 class="font-disp text-[19px] font-extrabold text-(--pk-cream)">
          Tournoi introuvable
        </h1>
        <NuxtLink
          to="/"
          class="inline-flex items-center gap-1.75 font-sans text-sm font-bold text-(--pk-on-navy-2)"
        >
          <UIcon name="i-lucide-arrow-left" class="size-4.5" />
          Retour à l'accueil
        </NuxtLink>
      </div>

      <div
        v-else-if="!tournamentIsCompleted"
        class="flex flex-col items-center gap-3 py-16 text-center"
      >
        <h1 class="font-disp text-[19px] font-extrabold text-(--pk-cream)">
          Ce tournoi n'est pas encore terminé
        </h1>
        <p class="font-sans text-sm text-(--pk-on-navy-2)">
          Les résultats seront disponibles une fois le tournoi terminé.
        </p>
        <NuxtLink
          :to="`/tournaments/${tournamentId}`"
          class="inline-flex items-center gap-1.75 font-sans text-sm font-bold text-(--pk-on-navy-2)"
        >
          <UIcon name="i-lucide-arrow-left" class="size-4.5" />
          Retour au tournoi
        </NuxtLink>
      </div>

      <div v-else>
        <NuxtLink
          :to="`/tournaments/${tournamentId}?tab=classement`"
          class="inline-flex items-center gap-1.75 pt-4 font-sans text-sm font-bold text-(--pk-on-navy-2)"
        >
          <UIcon name="i-lucide-arrow-left" class="size-4.5" />
          Retour
        </NuxtLink>

        <!-- Bloc champion -->
        <div
          v-if="championEntry"
          class="flex flex-col items-center text-center"
        >
          <p
            class="mt-6 font-disp text-[11px] font-extrabold tracking-[0.14em] uppercase text-secondary"
          >
            {{ currentTournament.name }}
          </p>
          <h1
            class="mt-1 font-disp text-[40px] font-extrabold tracking-[-0.02em] uppercase text-(--pk-cream)"
          >
            Champions
          </h1>

          <div class="relative mt-4">
            <span
              aria-hidden="true"
              class="pointer-events-none absolute top-1/2 left-1/2 size-75 -translate-x-1/2 -translate-y-1/2 [background:radial-gradient(circle,rgb(var(--pk-gold-rgb)/0.28),transparent_65%)]"
            />
            <BouleAvatar
              tone="gold"
              :size="110"
              :aria-label="`Champions : ${championEntry.team.name}`"
            >
              <UIcon name="i-lucide-trophy" class="size-9 text-(--pk-navy)" />
            </BouleAvatar>
          </div>

          <h2
            class="mt-4 truncate font-disp text-[26px] font-extrabold tracking-[-0.01em] text-(--pk-cream)"
          >
            {{ championEntry.team.name }}
          </h2>

          <div class="mt-3 flex flex-wrap items-center justify-center gap-2">
            <span
              class="rounded-lg bg-[rgb(var(--pk-gold-rgb)/0.14)] px-2.5 py-1.25 font-disp text-[11px] font-extrabold tracking-[0.04em] uppercase text-secondary"
            >
              {{ championWinsLabel }}
            </span>
            <span
              class="rounded-lg bg-[rgb(var(--pk-gold-rgb)/0.14)] px-2.5 py-1.25 font-disp text-[11px] font-extrabold tracking-[0.04em] uppercase text-secondary"
            >
              {{ championLossesLabel }}
            </span>
            <span
              class="rounded-lg bg-[rgb(var(--pk-gold-rgb)/0.14)] px-2.5 py-1.25 font-disp text-[11px] font-extrabold tracking-[0.04em] uppercase text-secondary"
            >
              {{ championDiffLabel }}
            </span>
          </div>
        </div>

        <!-- Cartes 2e / 3e (0, 1 ou 2 cartes selon le nombre d'équipes) -->
        <div v-if="runnersUp.length > 0" class="mt-7 grid grid-cols-2 gap-2.75">
          <div
            v-for="entry in runnersUp"
            :key="entry.team.id"
            class="flex flex-col items-center gap-1.5 rounded-(--pk-r-card) bg-white/6 p-3.5 text-center"
          >
            <BouleAvatar :tone="medalTone(entry.rank)" :size="48" />
            <p
              class="font-num text-[18px] font-bold"
              :class="RUNNER_UP_RANK_COLOR_CLASS[entry.rank]"
            >
              #{{ entry.rank }}
            </p>
            <p
              class="w-full truncate font-disp text-sm font-bold text-(--pk-cream)"
            >
              {{ entry.team.name }}
            </p>
            <p
              class="font-sans text-[11.5px] text-(--pk-on-navy-3) tabular-nums"
            >
              {{ entry.ranking.wins }}V · {{ entry.ranking.losses }}D ·
              {{ signedDiff(entry.ranking.pointDifference) }}
            </p>
          </div>
        </div>

        <!-- Partage : pas encore construit — bouton désactivé -->
        <UButton
          color="primary"
          block
          disabled
          icon="i-lucide-share"
          class="mt-7 h-13.5 gap-2.25 rounded-[14px] font-disp text-[14.5px] font-extrabold tracking-[0.03em] uppercase text-(--pk-cream)"
          :ui="{ leadingIcon: 'size-4.5' }"
        >
          Partager le podium
        </UButton>

        <!-- bg-transparent : le compound outline×neutral du thème pose un
             bg-default (crème) qui rendrait le bouton plein sur le navy. -->
        <UButton
          :to="`/tournaments/${tournamentId}?tab=classement`"
          variant="outline"
          color="neutral"
          block
          class="mt-2.5 h-12.5 rounded-[14px] bg-transparent font-disp text-[13.5px] font-extrabold tracking-[0.04em] uppercase text-(--pk-on-navy-2) ring-white/14 hover:bg-white/5 active:bg-white/5"
        >
          Revoir le classement complet
        </UButton>

        <p
          class="mt-4.5 text-center font-sans text-[11.5px] tracking-[0.04em] text-(--pk-on-navy-3)"
        >
          <template v-if="currentTournament.location"
            >{{ currentTournament.location }} ·
          </template>
          {{ completedMatchCount }} matchs joués · {{ roundCount }}
          {{ roundCount > 1 ? "manches" : "manche" }}
        </p>
      </div>
    </div>
  </div>
</template>
