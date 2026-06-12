<script setup lang="ts">
// Pattern d'erreurs : les actions du store throw ; on attrape ici et on
// affiche un toast via useErrorToast (voir composables/useErrorToast).
//
// Layout désactivé : l'écran porte son propre header navy (AppHeader mode
// interne, onglets intégrés) — le bandeau crème du layout ferait doublon.
import type { Match, Team, TournamentStatus } from "../../../types";

definePageMeta({ layout: false });

const route = useRoute();
const tournamentStore = useTournamentStore();
const {
  currentTournament,
  teams,
  matches,
  ranking,
  isOwnerOfCurrentTournament,
  profileById,
} = storeToRefs(tournamentStore);
const { showError } = useErrorToast();

// Alias local lisible : tout l'ownership conditionne des actions admin
// dans le template, on ne le manipule jamais ailleurs.
const isOwner = isOwnerOfCurrentTournament;

// Hydratation best-effort du profil de l'organisateur, uniquement quand
// je ne suis pas l'owner (inutile d'afficher "Organisé par moi"). Le
// `void` est fire-and-forget ; loadProfilesByIds ne throw jamais.
watch(
  currentTournament,
  (tournament) => {
    if (tournament && !isOwner.value) {
      void tournamentStore.loadProfilesByIds([tournament.ownerId]);
    }
  },
  { immediate: true },
);

// Nom de l'organisateur si son profil est résolu, sinon null (la ligne
// "Organisé par" est alors omise — pas de placeholder).
function organizerName(ownerId: string): string | null {
  return profileById.value[ownerId]?.displayName ?? null;
}

const tournamentId = computed(() => route.params.tournamentId as string);

const isLoadingDetail = ref(true);

// Token local pour invalider le flip de isLoadingDetail si une nouvelle
// requête a démarré entre-temps. Combiné avec le token store
// (loadTournament), on a une défense en profondeur : le store ignore
// l'écriture des données de A, la page ignore le flip de A.
let loadDetailRequestId = 0;

// watch(tournamentId, immediate: true) : couvre le mount initial ET
// la réutilisation de composant Nuxt sur changement de paramètre de
// route (sans cela, onMounted ne refire pas et l'état reste bloqué).
watch(
  tournamentId,
  async (id) => {
    const requestId = ++loadDetailRequestId;
    isLoadingDetail.value = true;
    try {
      await tournamentStore.loadTournament(id);
      // Fire-and-forget : les membres alimentent le sélecteur de joueurs du
      // TeamFormModal (et la modal "Gérer les invités"). loadTournamentMembers
      // a son propre token de course, OK de l'appeler en parallèle sans await.
      void tournamentStore.loadTournamentMembers(id);
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

// Verrouillage : un tournoi qui a démarré (ou terminé) ne doit plus
// permettre de modifier les équipes — sinon le classement et les
// matchs déjà générés deviendraient incohérents.
const tournamentIsLocked = computed(() => {
  const status = currentTournament.value?.status;
  return status === "in_progress" || status === "completed";
});

const STATUS_LABELS: Record<TournamentStatus, string> = {
  draft: "Brouillon",
  in_progress: "En cours",
  completed: "Terminé",
};

const statusLabel = computed(() =>
  currentTournament.value ? STATUS_LABELS[currentTournament.value.status] : "",
);

// Sous-titre du header (présentation pure) : « lieu · date », complété de
// l'organisateur pour les non-owners quand son profil est résolu.
const headerSubtitle = computed(() => {
  const tournament = currentTournament.value;
  if (!tournament) return "";
  const parts: string[] = [];
  if (tournament.location) parts.push(tournament.location);
  parts.push(formatDate(tournament.date));
  if (!isOwner.value) {
    const organizer = organizerName(tournament.ownerId);
    if (organizer) parts.push(`Par ${organizer}`);
  }
  return parts.join(" · ");
});

const tabItems = [
  { label: "Équipes", slot: "teams" as const },
  { label: "Matchs", slot: "matches" as const },
  { label: "Classement", slot: "ranking" as const },
];

// Onglets du header navy : AppHeader attend { id, label } ; les ids
// reprennent les indices string de l'activeTab existant (manipulé par
// startTournament pour basculer vers Matchs au lancement).
const headerTabs = tabItems.map((tab, index) => ({
  id: String(index),
  label: tab.label,
}));

const activeTab = ref("0");

const formModalOpen = ref(false);
const editingTeam = ref<Team | null>(null);
const deleteModalOpen = ref(false);
const teamPendingDeletion = ref<Team | null>(null);

function openCreateForm() {
  editingTeam.value = null;
  formModalOpen.value = true;
}

function openEditForm(team: Team) {
  editingTeam.value = team;
  formModalOpen.value = true;
}

function askDeleteConfirmation(team: Team) {
  teamPendingDeletion.value = team;
  deleteModalOpen.value = true;
}

async function confirmDelete() {
  if (teamPendingDeletion.value) {
    try {
      await tournamentStore.deleteTeam(teamPendingDeletion.value.id);
    } catch (error) {
      showError(error);
    }
  }
  teamPendingDeletion.value = null;
}

const teamsById = computed<Record<string, Team>>(() => {
  return Object.fromEntries(teams.value.map((team) => [team.id, team]));
});

function getTeamById(teamId: string): Team | null {
  return teamsById.value[teamId] ?? null;
}

// Noms affichés des joueurs d'une équipe (présentation pure) : pseudo live
// si le profil est résolu, sinon snapshot — via l'util partagée, comme
// le faisait TeamMemberList.
function teamPlayersNames(team: Team): string[] {
  return team.players.map((player) =>
    getPlayerDisplayName(player, profileById.value),
  );
}

type RoundGroup = { roundNumber: number; matches: Match[] };

// Les matchs sont stockés à plat avec un champ `roundNumber` ; on les regroupe
// pour l'affichage par manche, en triant par numéro de manche croissant.
const matchesByRound = computed<RoundGroup[]>(() => {
  const groupedMatches = new Map<number, Match[]>();
  for (const match of matches.value) {
    const existingMatchesInRound = groupedMatches.get(match.roundNumber) ?? [];
    existingMatchesInRound.push(match);
    groupedMatches.set(match.roundNumber, existingMatchesInRound);
  }
  return [...groupedMatches.entries()]
    .sort(([roundNumberA], [roundNumberB]) => roundNumberA - roundNumberB)
    .map(([roundNumber, matchesInRound]) => ({
      roundNumber,
      matches: matchesInRound,
    }));
});

const tournamentStatus = computed(() => currentTournament.value?.status);

const tournamentIsCompleted = computed(
  () => tournamentStatus.value === "completed",
);

const hasEnoughTeamsToStart = computed(() => teams.value.length >= 2);

const isGeneratingMatches = ref(false);

async function startTournament() {
  if (isGeneratingMatches.value) return;
  isGeneratingMatches.value = true;
  try {
    await tournamentStore.generateMatches();
    activeTab.value = String(
      tabItems.findIndex((tab) => tab.slot === "matches"),
    );
  } catch (error) {
    showError(error);
  } finally {
    isGeneratingMatches.value = false;
  }
}

const scoreModalOpen = ref(false);
const matchBeingScored = ref<Match | null>(null);

function openScoreModal(match: Match) {
  if (tournamentIsCompleted.value) return;
  matchBeingScored.value = match;
  scoreModalOpen.value = true;
}

const matchBeingScoredTeamA = computed(() =>
  matchBeingScored.value ? getTeamById(matchBeingScored.value.teamAId) : null,
);
const matchBeingScoredTeamB = computed(() =>
  matchBeingScored.value ? getTeamById(matchBeingScored.value.teamBId) : null,
);

// Côté gagnant d'un match pour ScoreboardEquipe (présentation pure :
// simple traduction du winnerId stocké vers 'A'/'B', aucun calcul).
function matchWinnerSide(match: Match): "A" | "B" | null {
  if (match.winnerId === null) return null;
  return match.winnerId === match.teamAId ? "A" : "B";
}

// Le classement est calculé par le store via computeRanking et affiché
// par la page — pas de logique métier ici.

const pendingMatchCount = computed(
  () => matches.value.filter((match) => match.status === "pending").length,
);

const hasAnyCompletedMatch = computed(() =>
  matches.value.some((match) => match.status === "completed"),
);

const allMatchesAreCompleted = computed(
  () => matches.value.length > 0 && pendingMatchCount.value === 0,
);

const canCompleteTournament = computed(
  () =>
    tournamentStatus.value === "in_progress" && allMatchesAreCompleted.value,
);

const completeModalOpen = ref(false);
const isCompletingTournament = ref(false);

function askCompleteConfirmation() {
  if (!canCompleteTournament.value) return;
  completeModalOpen.value = true;
}

async function confirmCompleteTournament() {
  if (isCompletingTournament.value) return;
  isCompletingTournament.value = true;
  try {
    await tournamentStore.completeTournament();
  } catch (error) {
    showError(error);
  } finally {
    isCompletingTournament.value = false;
    completeModalOpen.value = false;
  }
}

// La suppression n'est possible qu'en `draft` : un tournoi `in_progress`
// ou `completed` a une valeur historique qu'on ne veut pas perdre par
// erreur. La cascade côté repository gère teams + matches.
const tournamentCanBeDeleted = computed(
  () => tournamentStatus.value === "draft",
);

const tournamentDeleteModalOpen = ref(false);
const isDeletingTournament = ref(false);

function askTournamentDeleteConfirmation() {
  if (!tournamentCanBeDeleted.value) return;
  tournamentDeleteModalOpen.value = true;
}

async function confirmTournamentDelete() {
  if (isDeletingTournament.value) return;
  isDeletingTournament.value = true;
  try {
    await tournamentStore.deleteTournament(tournamentId.value);
    tournamentDeleteModalOpen.value = false;
    await navigateTo("/");
  } catch (error) {
    showError(error);
  } finally {
    isDeletingTournament.value = false;
  }
}

const visibilityToggleModalOpen = ref(false);
const isTogglingVisibility = ref(false);

function askVisibilityToggle() {
  if (!isOwner.value) return;
  visibilityToggleModalOpen.value = true;
}

const membersModalOpen = ref(false);

// Source de vérité unique du droit de gestion des invités. Deux
// conditions combinées, consommées par : (1) le v-if du bouton dans
// la barre d'actions, (2) la garde de openMembersModal, (3) le
// watcher d'auto-fermeture ci-dessous. Centraliser ici évite tout
// drift entre sites de consommation. L'invitation est autorisée sur
// les tournois privés ET publics (Phase F.1) : l'invité bascule en
// "Partagés avec moi" via la partition home, sans badge dédié.
const canManageMembers = computed(() => {
  if (!isOwner.value) return false;
  if (tournamentIsCompleted.value) return false;
  return true;
});

function openMembersModal() {
  if (!canManageMembers.value) return;
  membersModalOpen.value = true;
}

// Auto-fermeture si la permission disparaît pendant que le modal est
// ouvert : passage en 'completed', bascule public, perte d'ownership.
// Sans ce watch, l'utilisateur pourrait continuer à inviter/désinviter
// sur un tournoi qui ne le permet plus, le temps qu'il ferme à la
// main. Couvre notamment le cas multi-onglets.
watch(canManageMembers, (canManage) => {
  if (!canManage) {
    membersModalOpen.value = false;
  }
});

async function confirmVisibilityToggle() {
  if (currentTournament.value === null) return;
  if (isTogglingVisibility.value) return;
  isTogglingVisibility.value = true;
  try {
    const targetVisibility =
      currentTournament.value.visibility === "public" ? "private" : "public";
    await tournamentStore.setTournamentVisibility(
      currentTournament.value.id,
      targetVisibility,
    );
    visibilityToggleModalOpen.value = false;
  } catch (error) {
    showError(error);
  } finally {
    isTogglingVisibility.value = false;
  }
}

useHead(() => ({
  title: currentTournament.value
    ? `${currentTournament.value.name} — Pétankup`
    : "Tournoi — Pétankup",
}));
</script>

<template>
  <div class="min-h-screen bg-default text-default">
    <div class="mx-auto max-w-2xl">
      <div v-if="isLoadingDetail" class="py-12 text-center">
        <p class="font-sans text-sm text-(--pk-subtle)">
          Chargement du tournoi…
        </p>
      </div>

      <!-- Garde finale : on n'affiche le contenu que si le tournoi en
           mémoire correspond à l'id de route. La forme inline (vs un
           computed booléen) permet à volar de narrower currentTournament
           à non-null dans le v-else. -->
      <div
        v-else-if="!currentTournament || currentTournament.id !== tournamentId"
        class="space-y-4 py-12 text-center"
      >
        <h1 class="font-disp text-[19px] font-extrabold text-(--pk-ink)">
          Tournoi introuvable
        </h1>
        <UButton
          to="/"
          variant="ghost"
          color="neutral"
          icon="i-lucide-arrow-left"
        >
          Retour à l'accueil
        </UButton>
      </div>

      <div v-else>
        <AppHeader
          :back="{ label: 'Accueil', to: '/' }"
          :kicker="`● ${statusLabel}`"
          :title="currentTournament.name"
          :subtitle="headerSubtitle"
          :tabs="headerTabs"
          :active-tab="activeTab"
          @tab-change="activeTab = $event"
        >
          <template v-if="isOwner" #actions>
            <button
              type="button"
              :aria-label="
                currentTournament.visibility === 'public'
                  ? 'Rendre privé'
                  : 'Rendre public'
              "
              class="inline-flex size-8.5 items-center justify-center rounded-(--pk-r-sm) bg-(--pk-on-navy-10) text-(--pk-on-navy)"
              @click="askVisibilityToggle"
            >
              <UIcon
                :name="
                  currentTournament.visibility === 'public'
                    ? 'i-lucide-lock'
                    : 'i-lucide-globe'
                "
                class="size-4.5"
              />
            </button>
            <button
              v-if="canManageMembers"
              type="button"
              aria-label="Gérer les invités"
              class="inline-flex size-8.5 items-center justify-center rounded-(--pk-r-sm) bg-(--pk-on-navy-10) text-(--pk-on-navy)"
              @click="openMembersModal"
            >
              <UIcon name="i-lucide-users" class="size-4.5" />
            </button>
            <button
              v-if="tournamentCanBeDeleted"
              type="button"
              aria-label="Supprimer le tournoi"
              class="inline-flex size-8.5 items-center justify-center rounded-(--pk-r-sm) bg-(--pk-on-navy-10) text-(--pk-on-navy)"
              @click="askTournamentDeleteConfirmation"
            >
              <UIcon name="i-lucide-trash-2" class="size-4.5" />
            </button>
          </template>
        </AppHeader>

        <main class="px-4.5 pt-5.5 pb-10">
          <!-- ───── Onglet Équipes ───── -->
          <div v-if="activeTab === '0'" class="space-y-4">
            <div class="flex items-center justify-between">
              <h2
                class="font-disp text-[10px] font-extrabold tracking-widest uppercase text-(--pk-muted)"
              >
                {{ teams.length }} équipes inscrites
              </h2>
            </div>

            <div
              v-if="teams.length === 0"
              class="space-y-1 rounded-(--pk-r-card) border border-dashed border-(--pk-line) bg-(--pk-card) p-6 text-center"
            >
              <h3
                class="font-disp text-[16.5px] font-extrabold text-(--pk-ink)"
              >
                Aucune équipe pour l'instant
              </h3>
              <p class="font-sans text-sm text-(--pk-subtle)">
                Ajoutez les équipes participantes au tournoi
              </p>
            </div>

            <ul v-else class="space-y-2.75">
              <li v-for="team in teams" :key="team.id">
                <CarteEquipe
                  :name="team.name"
                  :players="teamPlayersNames(team)"
                  :show-actions="isOwner"
                  :actions-disabled="tournamentIsLocked"
                  @edit="openEditForm(team)"
                  @delete="askDeleteConfirmation(team)"
                />
              </li>
            </ul>

            <p
              v-if="tournamentIsLocked"
              class="font-sans text-xs text-(--pk-muted)"
            >
              Le tournoi a démarré, les équipes ne peuvent plus être modifiées.
            </p>

            <UButton
              v-if="isOwner"
              color="primary"
              variant="dashed"
              icon="i-lucide-plus"
              block
              :disabled="tournamentIsLocked"
              class="h-13 gap-2 rounded-[14px] font-disp text-[13.5px] font-extrabold tracking-[0.04em] uppercase"
              :ui="{ leadingIcon: 'size-4' }"
              @click="openCreateForm"
            >
              Ajouter une équipe
            </UButton>

            <div
              v-if="
                tournamentStatus === 'draft' && isOwner && hasEnoughTeamsToStart
              "
              class="space-y-2.5 pt-2"
            >
              <UButton
                color="primary"
                block
                :loading="isGeneratingMatches"
                class="h-13.5 rounded-[14px] font-disp text-[14.5px] font-extrabold tracking-[0.03em] uppercase text-(--pk-cream) shadow-(--pk-shadow-clay-lg)"
                @click="startTournament"
              >
                Lancer le tournoi
              </UButton>
              <p class="text-center font-sans text-xs text-(--pk-muted)">
                Une fois lancé, les équipes sont verrouillées.
              </p>
            </div>
          </div>

          <!-- ───── Onglet Matchs ───── -->
          <div v-else-if="activeTab === '1'" class="space-y-4">
            <!-- En brouillon, le CTA « Lancer le tournoi » vit dans l'onglet
                 Équipes — ici, uniquement les messages informatifs. -->
            <div
              v-if="
                tournamentStatus === 'draft' &&
                isOwner &&
                !hasEnoughTeamsToStart
              "
              class="rounded-(--pk-r-card) border border-dashed border-(--pk-line) bg-(--pk-card) p-6 text-center"
            >
              <p class="font-sans text-sm text-(--pk-subtle)">
                Ajoutez au moins 2 équipes pour lancer le tournoi.
              </p>
            </div>

            <div
              v-else-if="tournamentStatus === 'draft'"
              class="rounded-(--pk-r-card) border border-dashed border-(--pk-line) bg-(--pk-card) p-6 text-center"
            >
              <p class="font-sans text-sm text-(--pk-subtle)">
                Le tournoi n'a pas encore démarré.
              </p>
            </div>

            <div v-else class="space-y-6">
              <section
                v-for="roundGroup in matchesByRound"
                :key="roundGroup.roundNumber"
                class="space-y-2.75"
              >
                <h2
                  class="font-disp text-[10px] font-extrabold tracking-widest uppercase text-(--pk-muted)"
                >
                  Manche {{ roundGroup.roundNumber }}
                </h2>
                <ul class="space-y-2.75">
                  <li v-for="match in roundGroup.matches" :key="match.id">
                    <ScoreboardEquipe
                      mode="liste"
                      :team-a-name="getTeamById(match.teamAId)?.name ?? '—'"
                      :team-b-name="getTeamById(match.teamBId)?.name ?? '—'"
                      :score-a="match.scoreA"
                      :score-b="match.scoreB"
                      :winner-side="matchWinnerSide(match)"
                      :can-score="isOwner && !tournamentIsCompleted"
                      @score="openScoreModal(match)"
                    />
                  </li>
                </ul>
              </section>
            </div>
          </div>

          <!-- ───── Onglet Classement ───── -->
          <div v-else-if="activeTab === '2'" class="space-y-4">
            <div
              v-if="!hasAnyCompletedMatch"
              class="rounded-xl border border-dashed border-default bg-elevated p-6 text-center"
            >
              <p class="text-sm text-toned">
                Le classement apparaîtra après le premier match.
              </p>
            </div>

            <div v-else class="space-y-4">
              <RankingTable :ranking="ranking" :teams="teams" />

              <div v-if="tournamentStatus === 'in_progress'" class="space-y-2">
                <UButton
                  v-if="canCompleteTournament && isOwner"
                  icon="i-lucide-trophy"
                  color="primary"
                  size="lg"
                  block
                  @click="askCompleteConfirmation"
                >
                  Terminer le tournoi
                </UButton>
                <p
                  v-else-if="pendingMatchCount > 0"
                  class="text-center text-sm text-toned"
                >
                  {{ pendingMatchCount }}
                  {{
                    pendingMatchCount > 1
                      ? "matchs restants à jouer"
                      : "match restant à jouer"
                  }}
                </p>
              </div>

              <div
                v-else-if="tournamentIsCompleted"
                class="space-y-3 rounded-xl border border-default bg-elevated p-4 text-center"
              >
                <p class="text-sm text-toned">
                  Tournoi terminé le
                  {{ formatDate(currentTournament.updatedAt) }}
                </p>
                <UButton
                  :to="`/tournaments/${tournamentId}/results`"
                  variant="soft"
                  color="primary"
                  icon="i-lucide-trophy"
                  block
                >
                  Voir les résultats
                </UButton>
              </div>
            </div>
          </div>
        </main>

        <TeamFormModal v-model:open="formModalOpen" :team="editingTeam" />

        <TeamDeleteConfirmModal
          v-model:open="deleteModalOpen"
          :team="teamPendingDeletion"
          @confirmed="confirmDelete"
        />

        <ScoreInputModal
          v-model:open="scoreModalOpen"
          :match="matchBeingScored"
          :team-a="matchBeingScoredTeamA"
          :team-b="matchBeingScoredTeamB"
        />

        <TournamentCompleteConfirmModal
          v-model:open="completeModalOpen"
          :tournament-name="currentTournament.name"
          :is-submitting="isCompletingTournament"
          @confirmed="confirmCompleteTournament"
        />

        <TournamentDeleteConfirmModal
          v-model:open="tournamentDeleteModalOpen"
          :tournament-name="currentTournament.name"
          :is-submitting="isDeletingTournament"
          @confirmed="confirmTournamentDelete"
        />

        <TournamentVisibilityToggleModal
          v-model:open="visibilityToggleModalOpen"
          :current-visibility="currentTournament.visibility"
          :tournament-name="currentTournament.name"
          :is-submitting="isTogglingVisibility"
          @confirmed="confirmVisibilityToggle"
        />

        <TournamentMembersModal
          v-model:open="membersModalOpen"
          :tournament-id="tournamentId"
          :tournament-name="currentTournament.name"
        />
      </div>
    </div>
  </div>
</template>
