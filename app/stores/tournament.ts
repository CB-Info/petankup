import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { createRepository } from '../repositories'
import type { TournamentRepository } from '../repositories'
import type { Database } from '../types/database.types'
import type {
  TournamentMatch,
  Ranking,
  ScoreValidationResult,
  Team,
  Tournament,
  TournamentMember,
  TournamentVisibility,
} from '../types'
import {
  computeRanking,
  generateRoundRobinMatches,
  validateScore,
} from '../utils/tournament'
import { useIdentityStore } from './identity'
import { useProfileStore } from './profile'

type CreateTournamentInput = Omit<
  Tournament,
  'id' | 'status' | 'visibility' | 'ownerId' | 'createdAt' | 'updatedAt'
> & {
  visibility?: TournamentVisibility
}

type AddTeamInput = {
  name: string
  players: Array<{ userId: string | null, displayName: string }>
}

export const useTournamentStore = defineStore('tournament', () => {
  // Le client Supabase typé vient du module @nuxtjs/supabase ; il est
  // injecté dans la factory pour garder le repository testable.
  const client = useSupabaseClient<Database>()
  // useSupabaseSession() est hydratée déterministiquement par le plugin
  // du module @nuxtjs/supabase au boot (cf. CLAUDE.md). Elle ne sert plus
  // ici qu'au reset du logout ; l'identité vit dans le store identity.
  const session = useSupabaseSession()
  const repository: TournamentRepository = createRepository(client)

  // L'identité de session et le domaine profil vivent dans leurs propres
  // stores ; ce store ne porte plus que le domaine tournoi. L'identité est
  // résolue par le store identity (amorcé par app/plugins/identity.client.ts),
  // jamais ici. Dépendance à sens unique : rien ne dépend en retour de ce
  // store.
  const identityStore = useIdentityStore()
  const profileStore = useProfileStore()

  const tournaments = ref<Tournament[]>([])
  const currentTournament = ref<Tournament | null>(null)
  const teams = ref<Team[]>([])
  const matches = ref<TournamentMatch[]>([])
  const ranking = ref<Ranking[]>([])

  // Memberships où l'utilisateur courant est invité (user_id ===
  // currentUserId). Source de vérité du sélecteur sharedTournaments
  // et du filtre d'exclusion sur publicTournaments. Peuplée en
  // parallèle de tournaments dans loadTournaments. Helper INTERNE :
  // non exposé dans le `return` (le store sort le sélecteur dérivé,
  // pas la liste brute).
  const myMemberships = ref<TournamentMember[]>([])

  // État du modal "Gérer les invités" (B.3) : liste des membres du
  // tournoi courant, chargée à la demande par loadTournamentMembers.
  // Exposé dans le `return` car consommé par le composant.
  const currentTournamentMembers = ref<TournamentMember[]>([])

  // Garde de cohérence : id du tournoi pour lequel
  // currentTournamentMembers a été chargé. Permet à inviteMemberByDisplayName de
  // savoir si append à la liste courante a du sens — le modal pourrait
  // viser un autre tournoi entre le déclenchement de l'invitation et
  // sa résolution. Helper INTERNE : non exposé.
  const currentTournamentMembersTournamentId = ref<string | null>(null)

  // Flag global utilisé pour signaler qu'une opération de persistance est
  // en cours. Booléen simple : en cas d'actions concurrentes, la 1ère qui
  // termine remet à false même si une autre est en cours — acceptable
  // pour le MVP, le spinner peut clignoter brièvement.
  const isLoading = ref(false)

  // Partition mutuellement exclusive des tournois visibles pour la home,
  // évaluée dans cet ordre :
  //   1. myTournaments       : ownerId === currentUserId
  //                            (private + public confondus, anti-doublon)
  //   2. sharedTournaments   : in myMemberships AND NOT in myTournaments
  //   3. publicTournaments   : visibility === 'public'
  //                            AND NOT in myTournaments
  //                            AND NOT in sharedTournaments
  // Si currentUserId est null (logout en cours d'évaluation), les trois
  // listes sont vides.
  const myTournaments = computed(() => {
    const userId = identityStore.currentUserId
    if (userId === null) return []
    return tournaments.value.filter(t => t.ownerId === userId)
  })

  // Tournois où je suis invité (membership) ET dont je ne suis pas
  // owner. La garde ownerId !== userId est défensive : la policy
  // INSERT et la RPC bloquent déjà les self-invites côté DB, mais on
  // se protège ici contre tout état impossible (membership orphelin
  // après un transfert d'ownership futur, par ex.).
  const sharedTournaments = computed<Tournament[]>(() => {
    const userId = identityStore.currentUserId
    if (userId === null) return []
    const memberTournamentIds = new Set(
      myMemberships.value.map(membership => membership.tournamentId),
    )
    return tournaments.value.filter(
      tournament =>
        memberTournamentIds.has(tournament.id)
        && tournament.ownerId !== userId,
    )
  })

  const publicTournaments = computed<Tournament[]>(() => {
    const userId = identityStore.currentUserId
    if (userId === null) return []
    const memberTournamentIds = new Set(
      myMemberships.value.map(membership => membership.tournamentId),
    )
    return tournaments.value.filter(
      tournament =>
        tournament.visibility === 'public'
        && tournament.ownerId !== userId
        && !memberTournamentIds.has(tournament.id),
    )
  })

  // Sélecteur dérivé pour les pages qui conditionnent des actions admin
  // sur la propriété du tournoi courant. Encapsule la comparaison ici
  // plutôt que de laisser fuiter currentUserId : l'identité utilisateur
  // reste interne, seul le booléen sort. Faux si pas de tournoi courant
  // ou pas d'utilisateur authentifié.
  const isOwnerOfCurrentTournament = computed<boolean>(() => {
    const userId = identityStore.currentUserId
    if (userId === null) return false
    if (currentTournament.value === null) return false
    return currentTournament.value.ownerId === userId
  })

  // Erreur du dernier loadTournaments. La home la surface dans une
  // branche dédiée (avec bouton "Réessayer") plutôt que de rester en
  // "Chargement…" indéfini ou de basculer faussement sur l'empty state.
  // Cleared sur succès.
  const lastLoadTournamentsError = ref<unknown>(null)

  // True dès qu'un fetch loadTournaments a réussi pour la session
  // courante. Le watcher de session le remet à false sur logout, ce qui
  // force un refetch via loadTournamentsForCurrentSession sans que la
  // home ait à le savoir. Exposé pour permettre à la home de gater ses
  // 4 états (erreur / chargement / empty / sections).
  const hasFetchedTournaments = ref(false)

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
    await repository.updateTournament(updatedTournament)
    replaceTournamentInList(updatedTournament)
    syncCurrentTournamentIfMatches(updatedTournament)
  }

  // Primitive de fetch : charge `tournaments` ET `myMemberships` en
  // parallèle (le 2e fetch alimente sharedTournaments + l'exclusion sur
  // publicTournaments) et marque hasFetchedTournaments. NE résout PAS
  // l'identité (store identity) — l'entrée pour la home reste
  // loadTournamentsForCurrentSession (gardes d'idempotence et de dédup).
  // Conservée publique pour les tests qui vérifient le contrat repo→store.
  //
  // Garde anti-écriture tardive : on capture currentUserId au début et
  // on re-vérifie après les awaits. Si l'utilisateur a changé entre
  // temps (logout A → login B), la réponse de l'utilisateur A est
  // ignorée — pas d'écriture dans le state, pas de peuplement d'erreur.
  // Cohérent avec le token utilisé dans loadTournamentsForCurrentSession
  // pour invalider une résolution d'identité tardive.
  async function loadTournaments(): Promise<void> {
    return withLoading(async () => {
      const userId = identityStore.currentUserId
      if (userId === null) return
      try {
        const [loadedTournaments, loadedMemberships] = await Promise.all([
          repository.getAllTournaments(),
          repository.getMyMemberships(userId),
        ])
        if (identityStore.currentUserId !== userId) return
        tournaments.value = loadedTournaments
        myMemberships.value = loadedMemberships
        hasFetchedTournaments.value = true
        lastLoadTournamentsError.value = null
      }
      catch (error) {
        if (identityStore.currentUserId !== userId) return
        // On NE marque PAS fetched en cas d'erreur — sinon on
        // confondrait "aucun tournoi" avec "échec de chargement".
        lastLoadTournamentsError.value = error
        throw error
      }
    })
  }

  async function createTournament(data: CreateTournamentInput): Promise<Tournament> {
    return withLoading(async () => {
      const ownerId = identityStore.requireAuthenticatedUserId()
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
      await repository.createTournament(newTournament)
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
      // avec le clear de deleteTournament. La liste de membres est
      // également invalidée : changer de tournoi rend obsolète tout
      // état de modal "Gérer les invités" du tournoi précédent.
      currentTournament.value = null
      teams.value = []
      matches.value = []
      ranking.value = []
      currentTournamentMembers.value = []
      currentTournamentMembersTournamentId.value = null

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

  // L'id, les timestamps et le snapshot de pseudo sont gérés par la RPC
  // create_team_with_players ; le store ne génère plus rien côté client et
  // pousse le Team reconstitué retourné par le repo.
  async function addTeam(data: AddTeamInput): Promise<Team> {
    return withLoading(async () => {
      const tournament = requireCurrentTournament()
      const newTeam = await repository.createTeam(
        tournament.id,
        data.name,
        data.players,
      )
      teams.value.push(newTeam)
      return newTeam
    })
  }

  async function updateTeam(
    teamId: string,
    name: string,
    players: AddTeamInput['players'],
  ): Promise<Team> {
    return withLoading(async () => {
      const updated = await repository.updateTeam(teamId, name, players)
      const teamIndex = teams.value.findIndex(team => team.id === updated.id)
      if (teamIndex !== -1) {
        teams.value[teamIndex] = updated
      }
      return updated
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
      await repository.createMatches(generatedMatches)
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
    const updatedMatch: TournamentMatch = {
      ...matchToUpdate,
      scoreA,
      scoreB,
      winnerId: scoreA > scoreB ? matchToUpdate.teamAId : matchToUpdate.teamBId,
      status: 'completed',
      updatedAt: nowIso(),
    }

    return withLoading(async () => {
      await repository.updateMatch(updatedMatch)
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
      // La liste n'est chargée que par l'accueil : depuis la page tournoi
      // (lien profond), le tournoi courant fait foi.
      const tournament = tournaments.value.find(
        existing => existing.id === tournamentId,
      ) ?? (currentTournament.value?.id === tournamentId ? currentTournament.value : undefined)
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

  // Chargement de la liste pour l'identité courante. Appelée par l'accueil
  // (watcher gaté sur identity.currentUserId) et par son bouton
  // « Réessayer ». L'identité est résolue ailleurs (store identity, amorcé
  // par le plugin) : sans identité, no-op — la page reste en chargement
  // jusqu'à ce que le watcher de page rappelle. Les erreurs sont stockées
  // dans lastLoadTournamentsError, pas re-thrown : le caller observe le ref.
  //
  // Deux gardes contre les requêtes en double :
  //  - en vol : une seconde demande pour le même user pendant le RTT
  //    (remontage rapide, Réessayer) reçoit la promesse déjà en cours ;
  //  - déjà chargé : pas de refetch tant que hasFetchedTournaments tient
  //    pour ce user (remis à false au logout ; un changement de compte
  //    passe toujours par là).
  let loadedForUserId: string | null = null
  let pendingTournamentsLoad: { userId: string, promise: Promise<void> } | null = null

  async function loadTournamentsForCurrentSession(): Promise<void> {
    const sub = identityStore.currentUserId
    if (sub === null) return
    if (pendingTournamentsLoad !== null && pendingTournamentsLoad.userId === sub) {
      return pendingTournamentsLoad.promise
    }
    if (loadedForUserId === sub && hasFetchedTournaments.value) return

    const promise = fetchTournamentsFor(sub).finally(() => {
      // Ne libère le slot que s'il est encore le sien : une demande pour
      // un autre user (changement de compte en plein vol) l'a peut-être
      // déjà remplacé.
      if (pendingTournamentsLoad?.promise === promise) {
        pendingTournamentsLoad = null
      }
    })
    pendingTournamentsLoad = { userId: sub, promise }
    return promise
  }

  // Requête de loadTournamentsForCurrentSession pour un user donné.
  async function fetchTournamentsFor(sub: string): Promise<void> {
    try {
      await loadTournaments()
      loadedForUserId = sub
    }
    catch {
      // Erreur déjà stockée dans lastLoadTournamentsError par
      // loadTournaments. Swallow ici pour éviter un warning sur
      // promesse rejetée non handled côté watcher / bouton retry.
    }
  }

  // Compteur monotone interne pour invalider les réponses tardives de
  // loadTournamentMembers : si une nouvelle requête démarre alors qu'une
  // précédente attend encore, la précédente abandonne silencieusement
  // pour ne pas écraser le résultat de la plus récente. Même pattern
  // que lastLoadTournamentRequestId.
  let lastLoadTournamentMembersRequestId = 0

  async function loadTournamentMembers(tournamentId: string): Promise<void> {
    const requestId = ++lastLoadTournamentMembersRequestId
    // Clear-at-start : pas de flash des membres du tournoi précédent
    // pendant le RTT Supabase lors d'une navigation cross-tournament.
    currentTournamentMembers.value = []
    currentTournamentMembersTournamentId.value = tournamentId
    return withLoading(async () => {
      const fetched = await repository.getMembersByTournament(tournamentId)
      if (requestId !== lastLoadTournamentMembersRequestId) return
      currentTournamentMembers.value = fetched
    })
  }

  // Invitation d'un membre au tournoi. La RPC repo retourne la ligne
  // insérée (snapshot member_email + ids) que l'on append au state du
  // modal SI le modal vise toujours le même tournoi. Sinon (cas
  // défensif : navigation entre invitation déclenchée et résolution),
  // l'écriture serait incohérente avec ce que l'utilisateur regarde
  // — on laisse passer la promesse sans toucher à currentTournamentMembers.
  // InviteMemberError se propage naturellement (withLoading ne swallow
  // pas) ; le composant en B.3 dispatch via `instanceof InviteMemberError`.
  async function inviteMemberByDisplayName(
    tournamentId: string,
    displayName: string,
  ): Promise<TournamentMember> {
    return withLoading(async () => {
      const insertedMember = await repository.inviteMemberByDisplayName(
        tournamentId,
        displayName,
      )
      // Précharge le pseudo de l'invité AVANT de l'afficher : la ligne ne se
      // rend jamais sans son pseudo en cache, donc aucun placeholder/identité
      // ne flashe. loadProfilesByIds est best-effort (ne throw pas) ; en cas
      // d'échec, l'UI retombe sur le placeholder neutre, jamais l'email.
      await profileStore.loadProfilesByIds([insertedMember.userId])
      if (
        currentTournamentMembersTournamentId.value === insertedMember.tournamentId
      ) {
        currentTournamentMembers.value.push(insertedMember)
      }
      return insertedMember
    })
  }

  // Suppression d'un membre. Le filter sur currentTournamentMembers est
  // naturellement no-op si le membre n'est pas dans la liste courante
  // (cohérent avec la garde d'append d'inviteMemberByDisplayName).
  async function removeMember(memberId: string): Promise<void> {
    return withLoading(async () => {
      await repository.removeMember(memberId)
      currentTournamentMembers.value = currentTournamentMembers.value.filter(
        member => member.id !== memberId,
      )
    })
  }

  // Reset au logout (session null) : listes, membres, flags et erreur ne
  // survivent pas à une session. L'identité et le profil se réinitialisent
  // dans leurs propres stores ; le chargement, lui, n'est plus déclenché
  // ici mais par l'accueil, gaté sur l'identité. immediate : couvre le boot
  // sans session.
  watch(
    () => session.value,
    (currentSession) => {
      if (currentSession === null) {
        tournaments.value = []
        myMemberships.value = []
        currentTournamentMembers.value = []
        currentTournamentMembersTournamentId.value = null
        hasFetchedTournaments.value = false
        lastLoadTournamentsError.value = null
      }
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
    sharedTournaments,
    publicTournaments,
    isOwnerOfCurrentTournament,
    hasFetchedTournaments,
    lastLoadTournamentsError,
    currentTournamentMembers,
    loadTournaments,
    loadTournamentsForCurrentSession,
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
    loadTournamentMembers,
    inviteMemberByDisplayName,
    removeMember,
  }
})
