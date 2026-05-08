import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { createRepository } from '../repositories'
import type { TournamentRepository } from '../repositories'
import type { Database } from '../types/database.types'
import type {
  Match,
  Ranking,
  ScoreValidationResult,
  Team,
  Tournament,
  TournamentVisibility,
} from '../types'
import {
  computeRanking,
  generateRoundRobinMatches,
  validateScore,
} from '../utils/tournament'

type CreateTournamentInput = Omit<
  Tournament,
  'id' | 'status' | 'visibility' | 'ownerId' | 'createdAt' | 'updatedAt'
> & {
  visibility?: TournamentVisibility
}

type AddTeamInput = {
  name: string
  players: string[]
}

export const useTournamentStore = defineStore('tournament', () => {
  // Le client Supabase typé et l'utilisateur courant viennent du module
  // @nuxtjs/supabase. Le client est injecté dans la factory pour garder
  // le repository testable. L'utilisateur sert à peupler ownerId à la
  // création d'un tournoi (RLS DB).
  const client = useSupabaseClient<Database>()
  const user = useSupabaseUser()
  const repository: TournamentRepository = createRepository(client)

  const tournaments = ref<Tournament[]>([])
  const currentTournament = ref<Tournament | null>(null)
  const teams = ref<Team[]>([])
  const matches = ref<Match[]>([])
  const ranking = ref<Ranking[]>([])

  // Flag global utilisé pour signaler qu'une opération de persistance est
  // en cours. Booléen simple : en cas d'actions concurrentes, la 1ère qui
  // termine remet à false même si une autre est en cours — acceptable
  // pour le MVP, le spinner peut clignoter brièvement.
  const isLoading = ref(false)

  // Source unique de l'identité utilisateur côté store, alignée sur la
  // convention de requireAuthenticatedUserId() : useSupabaseUser() est
  // typé Ref<JwtPayload | null> par @nuxtjs/supabase v2, l'ID est dans
  // `sub` (RFC 7519), jamais dans `.id`. Variante NULLABLE utilisable
  // dans les contextes tolérants (computed évalué pendant un logout en
  // cours, où on veut une liste vide plutôt qu'une exception). Helper
  // INTERNE : non exposé dans le `return`.
  const currentUserId = computed<string | null>(
    () => user.value?.sub ?? null,
  )

  // Partition des tournois pour la home :
  // - myTournaments : owned par l'utilisateur courant (private + public
  //   confondus, anti-doublon avec publicTournaments).
  // - publicTournaments : public d'autres owners uniquement.
  // Si currentUserId est null (logout en cours d'évaluation), les deux
  // listes sont vides.
  const myTournaments = computed(() => {
    const userId = currentUserId.value
    if (userId === null) return []
    return tournaments.value.filter(t => t.ownerId === userId)
  })

  const publicTournaments = computed(() => {
    const userId = currentUserId.value
    if (userId === null) return []
    return tournaments.value.filter(
      t => t.visibility === 'public' && t.ownerId !== userId,
    )
  })

  // Sélecteur dérivé pour les pages qui conditionnent des actions admin
  // sur la propriété du tournoi courant. Encapsule la comparaison ici
  // plutôt que de laisser fuiter currentUserId : l'identité utilisateur
  // reste interne, seul le booléen sort. Faux si pas de tournoi courant
  // ou pas d'utilisateur authentifié.
  const isOwnerOfCurrentTournament = computed<boolean>(() => {
    const userId = currentUserId.value
    if (userId === null) return false
    if (currentTournament.value === null) return false
    return currentTournament.value.ownerId === userId
  })

  // Identité du user pour qui la liste actuelle de `tournaments` a été
  // chargée. null tant qu'aucun load n'a réussi dans un contexte user
  // ready. Évite qu'un load anonyme ou trop précoce empoisonne l'état
  // "chargé". Helper INTERNE.
  const loadedTournamentsForUserId = ref<string | null>(null)

  // Erreur du dernier loadTournaments. La home la surface dans une
  // branche dédiée (avec bouton "Réessayer") plutôt que de rester en
  // "Chargement…" indéfini ou de basculer faussement sur l'empty state.
  // Cleared sur succès.
  const lastLoadTournamentsError = ref<unknown>(null)

  // True UNIQUEMENT si la liste actuelle a été fetchée pour le user
  // courant. Faux sans user, faux après un échec, faux après un
  // changement de compte. Exposé pour permettre à la home de gater
  // ses 4 états (erreur / chargement / empty / sections).
  const hasLoadedTournaments = computed<boolean>(() => {
    const userId = currentUserId.value
    if (userId === null) return false
    return loadedTournamentsForUserId.value === userId
  })

  function nowIso(): string {
    return new Date().toISOString()
  }

  // Garde commune aux actions qui ne font sens que sur un tournoi chargé
  // (addTeam, generateMatches, submitScore, completeTournament). Lever
  // une erreur tôt évite de produire des entités orphelines.
  function requireCurrentTournament(): Tournament {
    if (currentTournament.value === null) {
      throw new Error('Aucun tournoi courant chargé')
    }
    return currentTournament.value
  }

  // Garde-fou : useSupabaseUser() ne devrait jamais être null grâce au
  // middleware d'auth, mais on protège la frontière.
  //
  // Attention : @nuxtjs/supabase v2 type useSupabaseUser comme
  // `Ref<JwtPayload | null>`, pas `Ref<User | null>`. Le ref est hydraté
  // via getClaims() qui retourne le payload JWT décodé. L'ID utilisateur
  // est donc dans `sub` (RFC 7519), pas dans `id` qui n'existe pas.
  // Lire `.id` retourne `undefined` silencieusement (index signature
  // [key: string]: any sur JwtPayload), ce qui faisait passer ownerId à
  // undefined et cassait l'INSERT côté RLS.
  function requireAuthenticatedUserId(): string {
    if (user.value === null) {
      throw new Error('Aucun utilisateur authentifié')
    }
    return user.value.sub
  }

  function replaceTournamentInList(updatedTournament: Tournament): void {
    const tournamentIndex = tournaments.value.findIndex(
      tournament => tournament.id === updatedTournament.id,
    )
    if (tournamentIndex !== -1) {
      tournaments.value[tournamentIndex] = updatedTournament
    }
  }

  function syncCurrentTournamentIfMatches(updatedTournament: Tournament): void {
    if (currentTournament.value?.id === updatedTournament.id) {
      currentTournament.value = updatedTournament
    }
  }

  // Bascule isLoading le temps de l'opération. Toute action qui touche
  // au repository est encapsulée par ce wrapper pour garder le toggle
  // centralisé (et symétrique en cas de throw).
  async function withLoading<T>(operation: () => Promise<T>): Promise<T> {
    isLoading.value = true
    try {
      return await operation()
    }
    finally {
      isLoading.value = false
    }
  }

  async function persistTournamentChange(updatedTournament: Tournament): Promise<void> {
    await repository.saveTournament(updatedTournament)
    replaceTournamentInList(updatedTournament)
    syncCurrentTournamentIfMatches(updatedTournament)
  }

  async function loadTournaments(): Promise<void> {
    return withLoading(async () => {
      // On lit user.value directement (pas via le computed currentUserId)
      // pour éviter d'évaluer ce dernier ici. Vue cacherait le résultat
      // et invaliderait sa cache uniquement sur changement de dépendance
      // tracée — ce qui n'est pas garanti dans les tests où le mock de
      // useSupabaseUser n'est pas un Vue ref. La sémantique reste la
      // même : sub est l'identifiant utilisateur (cf. CLAUDE.md).
      const currentUser = user.value
      if (currentUser === null) {
        // Pas d'user : on n'empoisonne pas l'état chargé. Le watcher
        // sur user rappellera ce loader dès que user.value sera
        // hydraté (cas magic link, cf. CLAUDE.md).
        return
      }
      const userId = currentUser.sub
      try {
        tournaments.value = await repository.getAllTournaments()
        loadedTournamentsForUserId.value = userId
        lastLoadTournamentsError.value = null
      }
      catch (error) {
        // On NE marque PAS loaded en cas d'erreur — sinon on
        // confondrait "aucun tournoi" avec "échec de chargement".
        lastLoadTournamentsError.value = error
        throw error
      }
    })
  }

  async function createTournament(data: CreateTournamentInput): Promise<Tournament> {
    return withLoading(async () => {
      const ownerId = requireAuthenticatedUserId()
      const timestamp = nowIso()
      const newTournament: Tournament = {
        ...data,
        id: crypto.randomUUID(),
        status: 'draft',
        visibility: data.visibility ?? 'private',
        ownerId,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      await repository.saveTournament(newTournament)
      tournaments.value.push(newTournament)
      return newTournament
    })
  }

  // Compteur monotone interne pour invalider les réponses Supabase
  // tardives : si une nouvelle requête loadTournament(B) démarre alors
  // qu'une précédente loadTournament(A) attend encore, on ne veut pas
  // que A écrive ses données par-dessus celles de B.
  let lastLoadTournamentRequestId = 0

  async function loadTournament(id: string): Promise<void> {
    const requestId = ++lastLoadTournamentRequestId
    return withLoading(async () => {
      // Clear-at-start : pas de flash de l'ancien tournoi pendant le
      // RTT Supabase lors d'une navigation cross-tournament. Cohérent
      // avec le clear de deleteTournament.
      currentTournament.value = null
      teams.value = []
      matches.value = []
      ranking.value = []

      const found = await repository.getTournamentById(id)
      if (requestId !== lastLoadTournamentRequestId) return
      if (found === undefined) return

      const loadedTeams = await repository.getTeamsByTournament(id)
      if (requestId !== lastLoadTournamentRequestId) return

      const loadedMatches = await repository.getMatchesByTournament(id)
      if (requestId !== lastLoadTournamentRequestId) return

      currentTournament.value = found
      teams.value = loadedTeams
      matches.value = loadedMatches
      refreshRanking()
    })
  }

  async function updateTournament(tournament: Tournament): Promise<void> {
    return withLoading(async () => {
      const updated: Tournament = { ...tournament, updatedAt: nowIso() }
      await persistTournamentChange(updated)
    })
  }

  async function deleteTournament(id: string): Promise<void> {
    return withLoading(async () => {
      await repository.deleteTournament(id)
      tournaments.value = tournaments.value.filter(
        tournament => tournament.id !== id,
      )
      if (currentTournament.value?.id === id) {
        currentTournament.value = null
        teams.value = []
        matches.value = []
        ranking.value = []
      }
    })
  }

  async function addTeam(data: AddTeamInput): Promise<Team> {
    return withLoading(async () => {
      const tournament = requireCurrentTournament()
      const timestamp = nowIso()
      const newTeam: Team = {
        id: crypto.randomUUID(),
        tournamentId: tournament.id,
        name: data.name,
        players: data.players,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      await repository.saveTeam(newTeam)
      teams.value.push(newTeam)
      return newTeam
    })
  }

  async function updateTeam(team: Team): Promise<void> {
    return withLoading(async () => {
      const updated: Team = { ...team, updatedAt: nowIso() }
      await repository.saveTeam(updated)
      const teamIndex = teams.value.findIndex(existing => existing.id === updated.id)
      if (teamIndex !== -1) {
        teams.value[teamIndex] = updated
      }
    })
  }

  async function deleteTeam(id: string): Promise<void> {
    return withLoading(async () => {
      const tournament = requireCurrentTournament()
      await repository.deleteTeam(id)
      teams.value = teams.value.filter(team => team.id !== id)
      // La cascade côté repository a pu supprimer des matchs : on resynchronise
      // depuis la source de vérité plutôt que de filtrer en double.
      matches.value = await repository.getMatchesByTournament(tournament.id)
      refreshRanking()
    })
  }

  async function generateMatches(): Promise<void> {
    return withLoading(async () => {
      const tournament = requireCurrentTournament()
      const generatedMatches = generateRoundRobinMatches(
        teams.value,
        tournament.id,
        nowIso(),
      )
      await repository.saveMatches(generatedMatches)
      matches.value = generatedMatches

      const tournamentInProgress: Tournament = {
        ...tournament,
        status: 'in_progress',
        updatedAt: nowIso(),
      }
      await persistTournamentChange(tournamentInProgress)

      refreshRanking()
    })
  }

  async function submitScore(
    matchId: string,
    scoreA: number,
    scoreB: number,
  ): Promise<ScoreValidationResult> {
    // Les early returns (validation invalide, match introuvable) ne touchent
    // pas au repository — on n'enveloppe pas dans withLoading pour éviter
    // un toggle inutile sur un retour synchrone.
    const validation = validateScore(scoreA, scoreB)
    if (!validation.valid) return validation

    const matchIndex = matches.value.findIndex(match => match.id === matchId)
    if (matchIndex === -1) {
      return { valid: false, error: 'Match introuvable.' }
    }

    const matchToUpdate = matches.value[matchIndex]!
    const updatedMatch: Match = {
      ...matchToUpdate,
      scoreA,
      scoreB,
      winnerId: scoreA > scoreB ? matchToUpdate.teamAId : matchToUpdate.teamBId,
      status: 'completed',
      updatedAt: nowIso(),
    }

    return withLoading(async () => {
      await repository.saveMatch(updatedMatch)
      matches.value[matchIndex] = updatedMatch
      refreshRanking()
      return { valid: true }
    })
  }

  function refreshRanking(): void {
    ranking.value = computeRanking(teams.value, matches.value)
  }

  async function completeTournament(): Promise<boolean> {
    // Idem submitScore : l'early return sur match pending ne touche pas
    // au repository et n'a pas besoin du wrapper.
    const tournament = requireCurrentTournament()
    const hasPendingMatch = matches.value.some(
      match => match.status === 'pending',
    )
    if (hasPendingMatch) return false

    return withLoading(async () => {
      const completedTournament: Tournament = {
        ...tournament,
        status: 'completed',
        updatedAt: nowIso(),
      }
      await persistTournamentChange(completedTournament)
      return true
    })
  }

  async function setTournamentVisibility(
    tournamentId: string,
    visibility: TournamentVisibility,
  ): Promise<void> {
    return withLoading(async () => {
      const tournament = tournaments.value.find(
        existing => existing.id === tournamentId,
      )
      if (tournament === undefined) {
        throw new Error('Tournoi introuvable')
      }
      const updated: Tournament = {
        ...tournament,
        visibility,
        updatedAt: nowIso(),
      }
      await persistTournamentChange(updated)
    })
  }

  // Auto-load dès que user.value devient non-null. Couvre :
  //  - le boot avec user déjà hydraté (immediate fire) ;
  //  - le flow magic-link où user.value est null au mount initial et
  //    s'hydrate quelques ms après (CLAUDE.md : page:start ne fire pas
  //    pour /confirm → /) ;
  //  - le changement de compte (logout A → null → login B → fetch B).
  // Remplace le `void loadTournaments()` du setup, qui pouvait fire
  // avec user null sans jamais retenter.
  //
  // On utilise une getter-source `() => user.value` plutôt que de
  // watcher le computed currentUserId : cela évite d'évaluer
  // currentUserId au setup, donc pas de cache stale à invalider en
  // production (et pas non plus dans les tests où le stub n'est pas
  // un Vue ref). currentUserId reste la convention exposée pour les
  // lectures synchrones, juste pas via ce watcher.
  watch(
    () => user.value,
    (currentUser) => {
      if (currentUser === null) return
      if (loadedTournamentsForUserId.value === currentUser.sub) return
      void loadTournaments().catch(() => {
        // Erreur stockée dans lastLoadTournamentsError ; la home la
        // surface avec un bouton "Réessayer". On swallow ici pour
        // éviter un warning Vue sur promesse rejetée non handled.
      })
    },
    { immediate: true },
  )

  return {
    tournaments,
    currentTournament,
    teams,
    matches,
    ranking,
    isLoading,
    myTournaments,
    publicTournaments,
    isOwnerOfCurrentTournament,
    hasLoadedTournaments,
    lastLoadTournamentsError,
    loadTournaments,
    createTournament,
    loadTournament,
    updateTournament,
    deleteTournament,
    setTournamentVisibility,
    addTeam,
    updateTeam,
    deleteTeam,
    generateMatches,
    submitScore,
    refreshRanking,
    completeTournament,
  }
})
