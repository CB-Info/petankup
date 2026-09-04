import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import type { TournamentRepository } from '../../app/repositories/TournamentRepository'
import type { TournamentMatch, Team, TeamPlayer, Tournament, TournamentMember } from '../../app/types'
import { InviteMemberError } from '../../app/types'

const STUB_USER_ID = '99999999-9999-4999-8999-999999999999'

// Référence mutable hissée avant l'évaluation du `vi.mock`. Permet de
// régénérer un mock vierge dans chaque `beforeEach`, tout en laissant
// `createRepository()` (appelé par le store à l'init) renvoyer
// l'instance courante.
const mockRepositoryRef = vi.hoisted(() => ({
  current: null as TournamentRepository | null,
}))

// Stub mutable pour useSupabaseUser. Le store appelle ce composable au
// setup pour récupérer l'utilisateur courant (peuplement de ownerId à
// la création). Forme alignée sur le runtime de @nuxtjs/supabase :
// un JwtPayload (champ `sub`), PAS un User (champ `id`). Si le stub
// utilisait `.id`, un store buggé qui lit `.id` passerait à tort.
const stubUserRef = vi.hoisted(() => ({
  value: { sub: '99999999-9999-4999-8999-999999999999' } as { sub: string } | null,
}))

// Stub mutable pour useSupabaseSession. Sert de déclencheur principal
// au watcher du store (cf. CLAUDE.md : la session est hydratée
// déterministiquement, contrairement à useSupabaseUser).
const stubSessionRef = vi.hoisted(() => ({
  value: { access_token: 'stub-token' } as { access_token: string } | null,
}))

// Sub renvoyé par le mock par défaut de getClaims(). DOIT être
// indépendant de stubUserRef pour pouvoir tester "user.value null +
// claims valides" (scénario magic-link). Valeur en dur (et non
// référence à STUB_USER_ID) parce que vi.hoisted est hissé au-dessus
// des `const` du fichier.
const stubClaimsSub = vi.hoisted(() => ({
  value: '99999999-9999-4999-8999-999999999999' as string | null,
}))

// Implémentation custom optionnelle de getClaims pour les tests qui
// ont besoin d'une promesse contrôlée manuellement (anti-race) ou
// d'une erreur. Si null, le mock par défaut utilise stubClaimsSub.
type GetClaimsResult
  = | { data: { claims: { sub: string }, header: object, signature: Uint8Array }, error: null }
  | { data: null, error: { message: string } }
  | { data: null, error: null }
const stubGetClaimsImpl = vi.hoisted(() => ({
  fn: null as null | (() => Promise<GetClaimsResult>),
}))

const supabaseClientStub = vi.hoisted(() => ({
  auth: {
    getClaims: vi.fn(async (): Promise<GetClaimsResult> => {
      if (stubGetClaimsImpl.fn !== null) return stubGetClaimsImpl.fn()
      const sub = stubClaimsSub.value
      if (sub === null) return { data: null, error: null }
      return {
        data: {
          claims: { sub },
          header: {},
          signature: new Uint8Array(),
        },
        error: null,
      }
    }),
  },
}))

vi.stubGlobal('useSupabaseClient', () => supabaseClientStub)
vi.stubGlobal('useSupabaseUser', () => stubUserRef)
vi.stubGlobal('useSupabaseSession', () => stubSessionRef)

vi.mock('../../app/repositories', () => ({
  createRepository: () => mockRepositoryRef.current!,
}))

// Import APRÈS le `vi.mock` pour la lisibilité (vitest hisse les deux
// de toute façon, donc l'ordre textuel est sans effet sur l'exécution).
import { useTournamentStore } from '../../app/stores/tournament'
import { useIdentityStore } from '../../app/stores/identity'

const NOW = '2026-01-01T00:00:00.000Z'
const UUID_V4_REGEX
  = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// Reconstitue un TeamPlayer comme le ferait la RPC : id généré, snapshot du
// displayName fourni, userId conservé.
function makeTeamPlayer(
  teamId: string,
  tournamentId: string,
  input: { userId: string | null, displayName: string },
): TeamPlayer {
  return {
    id: crypto.randomUUID(),
    teamId,
    tournamentId,
    userId: input.userId,
    displayNameSnapshot: input.displayName,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function makeTournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: crypto.randomUUID(),
    name: 'Tournoi de test',
    date: NOW,
    format: 'round_robin',
    status: 'draft',
    visibility: 'private',
    ownerId: STUB_USER_ID,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

// Mock en mémoire qui respecte le contrat TournamentRepository, y compris
// les cascades de suppression (tournament → teams + matches + members ;
// team → matches où elle apparaît). Reproduit le comportement de
// SupabaseRepository (cascades DB) sans toucher au réseau.
//
// Convention pour inviteMemberByDisplayName (déterministe par pseudo pour
// produire les codes d'erreur sans avoir à mocker la RPC SQL) :
//   - pseudo contenant 'NotFound'   → throw 'display_name_not_found'
//   - pseudo contenant 'SelfInvite' → throw 'self_invite'
//   - doublon (tournament_id, user_id) → throw 'already_member'
//   - sinon : insert + retour de la ligne TournamentMember.
// Pas de normalisation côté mock (le repo réel est pass-through). Le mock
// dérive un user_id stable depuis le pseudo afin que la contrainte unique
// fonctionne entre appels, et un member_email snapshot.
function createMockRepository(): TournamentRepository {
  let tournaments: Tournament[] = []
  let teams: Team[] = []
  let matches: TournamentMatch[] = []
  let tournamentMembers: TournamentMember[] = []

  function upsertById<T extends { id: string }>(items: T[], itemToUpsert: T): T[] {
    const existingIndex = items.findIndex(existing => existing.id === itemToUpsert.id)
    if (existingIndex === -1) return [...items, itemToUpsert]
    const updated = [...items]
    updated[existingIndex] = itemToUpsert
    return updated
  }

  function deriveUserIdFromDisplayName(displayName: string): string {
    // UUID v4 stable dérivé du pseudo normalisé : permet d'identifier un
    // "même invité" entre deux appels sans avoir à passer un userId
    // explicite côté test. Format inspiré du STUB_USER_ID.
    const normalized = displayName.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
    const padded = (normalized + '0000000000').slice(0, 12)
    return `00000000-0000-4000-8000-${padded}`.slice(0, 36).padEnd(36, '0')
  }

  return {
    getAllTournaments: async () => [...tournaments],
    getTournamentById: async id => tournaments.find(tournament => tournament.id === id),
    createTournament: async (tournament) => {
      tournaments = upsertById(tournaments, tournament)
    },
    updateTournament: async (tournament) => {
      tournaments = upsertById(tournaments, tournament)
    },
    deleteTournament: async (id) => {
      tournaments = tournaments.filter(tournament => tournament.id !== id)
      teams = teams.filter(team => team.tournamentId !== id)
      matches = matches.filter(match => match.tournamentId !== id)
      tournamentMembers = tournamentMembers.filter(
        member => member.tournamentId !== id,
      )
    },

    getTeamsByTournament: async tournamentId => teams.filter(team => team.tournamentId === tournamentId),
    createTeam: async (tournamentId, name, players) => {
      const teamId = crypto.randomUUID()
      const newTeam: Team = {
        id: teamId,
        tournamentId,
        name,
        players: players.map(player => makeTeamPlayer(teamId, tournamentId, player)),
        createdAt: NOW,
        updatedAt: NOW,
      }
      teams = [...teams, newTeam]
      return newTeam
    },
    updateTeam: async (teamId, name, players) => {
      const existing = teams.find(team => team.id === teamId)
      const tournamentId = existing?.tournamentId ?? 't-unknown'
      const updated: Team = {
        id: teamId,
        tournamentId,
        name,
        players: players.map(player => makeTeamPlayer(teamId, tournamentId, player)),
        createdAt: existing?.createdAt ?? NOW,
        updatedAt: NOW,
      }
      teams = upsertById(teams, updated)
      return updated
    },
    deleteTeam: async (id) => {
      teams = teams.filter(team => team.id !== id)
      matches = matches.filter(match => match.teamAId !== id && match.teamBId !== id)
    },

    getMatchesByTournament: async tournamentId => matches.filter(match => match.tournamentId === tournamentId),
    createMatches: async (matchesToSave) => {
      for (const matchToSave of matchesToSave) {
        matches = upsertById(matches, matchToSave)
      }
    },
    updateMatch: async (match) => {
      matches = upsertById(matches, match)
    },

    getMembersByTournament: async tournamentId =>
      tournamentMembers.filter(member => member.tournamentId === tournamentId),
    getMyMemberships: async userId =>
      tournamentMembers.filter(member => member.userId === userId),
    inviteMemberByDisplayName: async (tournamentId, displayName) => {
      if (displayName.includes('NotFound')) {
        throw new InviteMemberError('display_name_not_found')
      }
      if (displayName.includes('SelfInvite')) {
        throw new InviteMemberError('self_invite')
      }
      const userId = deriveUserIdFromDisplayName(displayName)
      const alreadyMember = tournamentMembers.some(
        member =>
          member.tournamentId === tournamentId && member.userId === userId,
      )
      if (alreadyMember) {
        throw new InviteMemberError('already_member')
      }
      const inserted: TournamentMember = {
        id: crypto.randomUUID(),
        tournamentId,
        userId,
        memberEmail: `${displayName.trim().toLowerCase()}@example.com`,
        createdAt: NOW,
        updatedAt: NOW,
      }
      tournamentMembers = [...tournamentMembers, inserted]
      return inserted
    },
    removeMember: async (memberId) => {
      // Reproduit le gate member_in_team de la RPC remove_tournament_member :
      // refus si le membre figure (par userId) dans une équipe du tournoi.
      const member = tournamentMembers.find(entry => entry.id === memberId)
      if (member !== undefined) {
        const memberIsInATeam = teams.some(
          team =>
            team.tournamentId === member.tournamentId
            && team.players.some(player => player.userId === member.userId),
        )
        if (memberIsInATeam) {
          throw new InviteMemberError('member_in_team')
        }
      }
      tournamentMembers = tournamentMembers.filter(
        entry => entry.id !== memberId,
      )
    },

    // Profile methods : stubs minimaux pour satisfaire l'interface
    // TournamentRepository (cf. C.2). Les tests de ce fichier ne
    // touchent jamais aux actions profile — la couverture profile
    // vit dans tests/unit/store-profiles.test.ts. Si un nouveau
    // test ici dépend du profil, étendre ces stubs.
    getMyProfile: async () => undefined,
    getProfilesByIds: async () => [],
    updateMyProfile: async () => {
      throw new Error('Not implemented in this test mock')
    },
    updateMyProfileVisibility: async () => {},
  }
}

beforeEach(() => {
  mockRepositoryRef.current = createMockRepository()
  stubUserRef.value = { sub: STUB_USER_ID }
  stubSessionRef.value = { access_token: 'stub-token' }
  stubClaimsSub.value = STUB_USER_ID
  stubGetClaimsImpl.fn = null
  supabaseClientStub.auth.getClaims.mockClear()
  setActivePinia(createPinia())
})

describe('useTournamentStore — tournaments', () => {
  it('createTournament: returns a draft tournament with a UUID and timestamps, and pushes it to the list', async () => {
    const store = useTournamentStore()
    // Attente du fetch initial du watcher (immediate) avant toute
    // mutation locale, sinon la résolution tardive de loadTournaments
    // écrase la push de createTournament. Voir aussi le bloc
    // "auth context" qui suit le même pattern.
    await flushPromises()

    const created = await store.createTournament({
      name: 'Tournoi du dimanche',
      date: NOW,
      format: 'round_robin',
    })

    expect(created.status).toBe('draft')
    expect(created.id).toMatch(UUID_V4_REGEX)
    expect(created.createdAt).not.toBe('')
    expect(created.updatedAt).not.toBe('')
    expect(created.ownerId).toBe(STUB_USER_ID)
    expect(store.tournaments).toHaveLength(1)
    expect(store.tournaments[0]).toEqual(created)
  })

  it('createTournament: reads ownerId from useSupabaseUser().value.sub (JwtPayload), not .id', async () => {
    // Le runtime peuple useSupabaseUser avec un JwtPayload (champ `sub`),
    // pas un User (champ `id`). Si on régresse vers `.id`, ownerId
    // deviendrait undefined et le payload INSERT n'aurait pas owner_id,
    // ce qui casse RLS côté DB.
    const store = useTournamentStore()

    const created = await store.createTournament({
      name: 'Test',
      date: NOW,
      format: 'round_robin',
    })

    expect(created.ownerId).toBe(STUB_USER_ID)
    expect(created.ownerId).not.toBeUndefined()
  })

  it('createTournament: applies default visibility "private" when omitted', async () => {
    const store = useTournamentStore()

    const created = await store.createTournament({
      name: 'Default visibility',
      date: NOW,
      format: 'round_robin',
    })

    expect(created.visibility).toBe('private')
  })

  it('createTournament: respects an explicit visibility "public"', async () => {
    const store = useTournamentStore()

    const created = await store.createTournament({
      name: 'Public tournament',
      date: NOW,
      format: 'round_robin',
      visibility: 'public',
    })

    expect(created.visibility).toBe('public')
  })

  it('loadTournaments: loads all tournaments persisted in the repository', async () => {
    const firstTournament = makeTournament({ name: 'Premier' })
    const secondTournament = makeTournament({ name: 'Second' })
    await mockRepositoryRef.current!.createTournament(firstTournament)
    await mockRepositoryRef.current!.createTournament(secondTournament)

    const store = useTournamentStore()
    await store.loadTournaments()

    expect(store.tournaments).toHaveLength(2)
    expect(store.tournaments.map(tournament => tournament.name).sort()).toEqual([
      'Premier',
      'Second',
    ])
  })

  it('deleteTournament: removes the tournament and resets currentTournament if it was loaded', async () => {
    const store = useTournamentStore()
    const created = await store.createTournament({
      name: 'À supprimer',
      date: NOW,
      format: 'round_robin',
    })
    await store.loadTournament(created.id)
    expect(store.currentTournament).not.toBeNull()

    await store.deleteTournament(created.id)

    expect(store.tournaments).toHaveLength(0)
    expect(store.currentTournament).toBeNull()
    expect(store.teams).toHaveLength(0)
    expect(store.matches).toHaveLength(0)
  })
})

describe('useTournamentStore — teams', () => {
  it('addTeam: adds three teams reactively to the current tournament', async () => {
    const store = useTournamentStore()
    const created = await store.createTournament({
      name: 'Tournoi',
      date: NOW,
      format: 'round_robin',
    })
    await store.loadTournament(created.id)

    await store.addTeam({ name: 'Les Boulistes', players: [{ userId: null, displayName: 'Alice' }, { userId: null, displayName: 'Bob' }] })
    await store.addTeam({ name: 'Les Pointus', players: [{ userId: null, displayName: 'Carla' }, { userId: null, displayName: 'Diego' }] })
    await store.addTeam({ name: 'Les Tireurs', players: [{ userId: null, displayName: 'Eva' }, { userId: null, displayName: 'Farid' }] })

    expect(store.teams).toHaveLength(3)
    for (const team of store.teams) {
      expect(team.id).toMatch(UUID_V4_REGEX)
      expect(team.tournamentId).toBe(created.id)
    }
  })

  it('deleteTeam: removes the team and decrements teams.length', async () => {
    const store = useTournamentStore()
    const created = await store.createTournament({
      name: 'Tournoi',
      date: NOW,
      format: 'round_robin',
    })
    await store.loadTournament(created.id)
    await store.addTeam({ name: 'Équipe A', players: [{ userId: null, displayName: 'Alice' }] })
    const teamToDelete = await store.addTeam({ name: 'Équipe B', players: [{ userId: null, displayName: 'Bob' }] })
    await store.addTeam({ name: 'Équipe C', players: [{ userId: null, displayName: 'Carla' }] })

    await store.deleteTeam(teamToDelete.id)

    expect(store.teams).toHaveLength(2)
    expect(store.teams.find(team => team.id === teamToDelete.id)).toBeUndefined()
  })
})

describe('useTournamentStore — matches', () => {
  async function setupTournamentWithFourTeams() {
    const store = useTournamentStore()
    const created = await store.createTournament({
      name: 'Tournoi',
      date: NOW,
      format: 'round_robin',
    })
    await store.loadTournament(created.id)
    await store.addTeam({ name: 'A', players: [{ userId: null, displayName: 'Alice' }] })
    await store.addTeam({ name: 'B', players: [{ userId: null, displayName: 'Bob' }] })
    await store.addTeam({ name: 'C', players: [{ userId: null, displayName: 'Carla' }] })
    await store.addTeam({ name: 'D', players: [{ userId: null, displayName: 'Diego' }] })
    return { store, tournamentId: created.id }
  }

  it('generateMatches: 4 teams → 6 matches, and the tournament moves to in_progress', async () => {
    const { store, tournamentId } = await setupTournamentWithFourTeams()

    await store.generateMatches()

    expect(store.matches).toHaveLength(6)
    expect(store.currentTournament?.status).toBe('in_progress')
    expect((await mockRepositoryRef.current!.getTournamentById(tournamentId))?.status).toBe('in_progress')
  })

  it('submitScore: a valid score completes the match and recomputes the ranking', async () => {
    const { store } = await setupTournamentWithFourTeams()
    await store.generateMatches()
    const matchToScore = store.matches[0]!

    const result = await store.submitScore(matchToScore.id, 13, 7)

    expect(result.valid).toBe(true)
    const updatedMatch = store.matches.find(match => match.id === matchToScore.id)!
    expect(updatedMatch.status).toBe('completed')
    expect(updatedMatch.scoreA).toBe(13)
    expect(updatedMatch.scoreB).toBe(7)
    expect(updatedMatch.winnerId).toBe(matchToScore.teamAId)
    const winnerRanking = store.ranking.find(rank => rank.teamId === matchToScore.teamAId)
    expect(winnerRanking?.wins).toBe(1)
  })

  it('submitScore: an invalid score (13-13) is rejected and leaves the match unchanged', async () => {
    const { store } = await setupTournamentWithFourTeams()
    await store.generateMatches()
    const matchToScore = store.matches[0]!

    const result = await store.submitScore(matchToScore.id, 13, 13)

    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
    const unchangedMatch = store.matches.find(match => match.id === matchToScore.id)!
    expect(unchangedMatch.status).toBe('pending')
    expect(unchangedMatch.scoreA).toBeNull()
    expect(unchangedMatch.scoreB).toBeNull()
  })

  it('submitScore: an out-of-bounds score (20-0) is rejected and leaves the match unchanged', async () => {
    const { store } = await setupTournamentWithFourTeams()
    await store.generateMatches()
    const matchToScore = store.matches[0]!

    const result = await store.submitScore(matchToScore.id, 20, 0)

    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
    const unchangedMatch = store.matches.find(match => match.id === matchToScore.id)!
    expect(unchangedMatch.status).toBe('pending')
    expect(unchangedMatch.scoreA).toBeNull()
    expect(unchangedMatch.scoreB).toBeNull()
  })
})

describe('useTournamentStore — completeTournament', () => {
  it('returns true and marks the tournament completed when every match is completed', async () => {
    const store = useTournamentStore()
    const created = await store.createTournament({
      name: 'Tournoi',
      date: NOW,
      format: 'round_robin',
    })
    await store.loadTournament(created.id)
    await store.addTeam({ name: 'A', players: [{ userId: null, displayName: 'Alice' }] })
    await store.addTeam({ name: 'B', players: [{ userId: null, displayName: 'Bob' }] })
    await store.generateMatches()
    expect(store.matches).toHaveLength(1)
    await store.submitScore(store.matches[0]!.id, 13, 5)

    const result = await store.completeTournament()

    expect(result).toBe(true)
    expect(store.currentTournament?.status).toBe('completed')
  })

  it('returns false and leaves the status unchanged when at least one match is still pending', async () => {
    const store = useTournamentStore()
    const created = await store.createTournament({
      name: 'Tournoi',
      date: NOW,
      format: 'round_robin',
    })
    await store.loadTournament(created.id)
    await store.addTeam({ name: 'A', players: [{ userId: null, displayName: 'Alice' }] })
    await store.addTeam({ name: 'B', players: [{ userId: null, displayName: 'Bob' }] })
    await store.addTeam({ name: 'C', players: [{ userId: null, displayName: 'Carla' }] })
    await store.addTeam({ name: 'D', players: [{ userId: null, displayName: 'Diego' }] })
    await store.generateMatches()
    await store.submitScore(store.matches[0]!.id, 13, 4)

    const result = await store.completeTournament()

    expect(result).toBe(false)
    expect(store.currentTournament?.status).toBe('in_progress')
  })
})

describe('useTournamentStore — visibility partition', () => {
  const OTHER_USER_ID = '00000000-0000-4000-8000-000000000000'

  it('myTournaments returns only tournaments owned by the current user', async () => {
    const store = useTournamentStore()
    const ownTournament = await store.createTournament({
      name: 'Mine',
      date: NOW,
      format: 'round_robin',
    })

    // Tournoi appartenant à un autre user, inséré directement via le
    // repository mocké pour bypasser createTournament qui force ownerId
    // au user courant.
    await mockRepositoryRef.current!.createTournament(
      makeTournament({
        name: 'Theirs',
        ownerId: OTHER_USER_ID,
        visibility: 'public',
      }),
    )
    await store.loadTournaments()

    expect(store.myTournaments).toHaveLength(1)
    expect(store.myTournaments[0]!.id).toBe(ownTournament.id)
  })

  it('publicTournaments returns only public tournaments NOT owned by the current user', async () => {
    const store = useTournamentStore()

    await store.createTournament({
      name: 'Mine private',
      date: NOW,
      format: 'round_robin',
    })
    await store.createTournament({
      name: 'Mine public',
      date: NOW,
      format: 'round_robin',
      visibility: 'public',
    })

    await mockRepositoryRef.current!.createTournament(
      makeTournament({
        name: 'Their public',
        ownerId: OTHER_USER_ID,
        visibility: 'public',
      }),
    )
    // Tournoi private d'un autre user : RLS l'aurait masqué côté DB.
    // Filtre JS doublé en sécurité.
    await mockRepositoryRef.current!.createTournament(
      makeTournament({
        name: 'Their private',
        ownerId: OTHER_USER_ID,
        visibility: 'private',
      }),
    )
    await store.loadTournaments()

    expect(store.publicTournaments).toHaveLength(1)
    expect(store.publicTournaments[0]!.name).toBe('Their public')
  })

  it('myTournaments and publicTournaments are empty when session is null (logout)', async () => {
    stubSessionRef.value = null
    stubUserRef.value = null
    stubClaimsSub.value = null
    const store = useTournamentStore()
    await mockRepositoryRef.current!.createTournament(
      makeTournament({ visibility: 'public', ownerId: OTHER_USER_ID }),
    )
    await store.loadTournaments()

    expect(store.myTournaments).toHaveLength(0)
    expect(store.publicTournaments).toHaveLength(0)
  })
})

describe('useTournamentStore — setTournamentVisibility', () => {
  it('switches a tournament from private to public and persists it', async () => {
    const store = useTournamentStore()
    await flushPromises()
    const created = await store.createTournament({
      name: 'À publier',
      date: NOW,
      format: 'round_robin',
    })
    expect(created.visibility).toBe('private')

    await store.setTournamentVisibility(created.id, 'public')

    const updated = store.tournaments.find(tournament => tournament.id === created.id)!
    expect(updated.visibility).toBe('public')

    const persisted = await mockRepositoryRef.current!.getTournamentById(created.id)
    expect(persisted?.visibility).toBe('public')
  })

  it('switches back from public to private', async () => {
    const store = useTournamentStore()
    await flushPromises()
    const created = await store.createTournament({
      name: 'À reprivatiser',
      date: NOW,
      format: 'round_robin',
      visibility: 'public',
    })

    await store.setTournamentVisibility(created.id, 'private')

    const updated = store.tournaments.find(tournament => tournament.id === created.id)!
    expect(updated.visibility).toBe('private')
  })

  it('throws when the tournament is unknown', async () => {
    const store = useTournamentStore()
    await expect(
      store.setTournamentVisibility('does-not-exist', 'public'),
    ).rejects.toThrow('Tournoi introuvable')
  })
})

describe('useTournamentStore — isOwnerOfCurrentTournament', () => {
  const OTHER_USER_ID = '00000000-0000-4000-8000-000000000000'

  it('returns true when the current tournament is owned by the current user', async () => {
    const store = useTournamentStore()
    const created = await store.createTournament({
      name: 'Mine',
      date: NOW,
      format: 'round_robin',
    })
    await store.loadTournament(created.id)

    expect(store.isOwnerOfCurrentTournament).toBe(true)
  })

  it('returns false when the current tournament is owned by someone else', async () => {
    const otherTournament = makeTournament({ ownerId: OTHER_USER_ID })
    await mockRepositoryRef.current!.createTournament(otherTournament)
    const store = useTournamentStore()
    await store.loadTournament(otherTournament.id)

    expect(store.isOwnerOfCurrentTournament).toBe(false)
  })

  it('returns false when there is no current tournament loaded', () => {
    const store = useTournamentStore()

    expect(store.isOwnerOfCurrentTournament).toBe(false)
  })

  it('returns false when there is no authenticated user', async () => {
    // Mount sans user, sans session, sans claims : currentUserId reste
    // null donc isOwnerOfCurrentTournament aussi, même si un tournoi
    // a été chargé via loadTournament (qui n'a pas de dépendance
    // d'identité côté store).
    stubUserRef.value = null
    stubSessionRef.value = null
    stubClaimsSub.value = null
    const someTournament = makeTournament({ ownerId: STUB_USER_ID })
    await mockRepositoryRef.current!.createTournament(someTournament)
    const store = useTournamentStore()
    await store.loadTournament(someTournament.id)

    expect(store.isOwnerOfCurrentTournament).toBe(false)
  })
})

describe('useTournamentStore — tournament_members partitioning', () => {
  const OTHER_USER_ID = '00000000-0000-4000-8000-000000000000'

  function makeMembership(
    tournamentId: string,
    overrides: Partial<TournamentMember> = {},
  ): TournamentMember {
    return {
      id: crypto.randomUUID(),
      tournamentId,
      userId: STUB_USER_ID,
      memberEmail: 'guest@example.com',
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    }
  }

  it('loadTournaments — fetches tournaments and myMemberships in parallel', async () => {
    const tournamentsSpy = vi.spyOn(mockRepositoryRef.current!, 'getAllTournaments')
    const membershipsSpy = vi.spyOn(mockRepositoryRef.current!, 'getMyMemberships')

    const store = useTournamentStore()
    // Le chargement n'est plus déclenché par l'instanciation du store : on
    // le demande, comme l'accueil (gaté sur l'identité, ici déjà résolue).
    await store.loadTournamentsForCurrentSession()

    expect(tournamentsSpy).toHaveBeenCalledTimes(1)
    expect(membershipsSpy).toHaveBeenCalledTimes(1)
    expect(membershipsSpy).toHaveBeenCalledWith(STUB_USER_ID)
    expect(store.hasFetchedTournaments).toBe(true)
    expect(store.lastLoadTournamentsError).toBeNull()
  })

  it('loadTournaments — surfaces error when getMyMemberships throws', async () => {
    vi.spyOn(mockRepositoryRef.current!, 'getMyMemberships').mockRejectedValue(
      new Error('memberships failed'),
    )

    const store = useTournamentStore()
    // Le chargement n'est plus déclenché par l'instanciation du store : on
    // le demande, comme l'accueil (gaté sur l'identité, ici déjà résolue).
    await store.loadTournamentsForCurrentSession()

    expect(store.lastLoadTournamentsError).not.toBeNull()
    expect((store.lastLoadTournamentsError as Error).message).toBe(
      'memberships failed',
    )
    expect(store.hasFetchedTournaments).toBe(false)
  })

  it('sharedTournaments — returns tournaments where user is invited and not owner', async () => {
    const sharedTournament = makeTournament({
      name: 'Tournoi partagé',
      ownerId: OTHER_USER_ID,
      visibility: 'private',
    })
    await mockRepositoryRef.current!.createTournament(
      makeTournament({ name: 'Privé perso', ownerId: STUB_USER_ID }),
    )
    await mockRepositoryRef.current!.createTournament(
      makeTournament({
        name: 'Public perso',
        ownerId: STUB_USER_ID,
        visibility: 'public',
      }),
    )
    await mockRepositoryRef.current!.createTournament(sharedTournament)
    vi.spyOn(mockRepositoryRef.current!, 'getMyMemberships').mockResolvedValue([
      makeMembership(sharedTournament.id),
    ])

    const store = useTournamentStore()
    // Le chargement n'est plus déclenché par l'instanciation du store : on
    // le demande, comme l'accueil (gaté sur l'identité, ici déjà résolue).
    await store.loadTournamentsForCurrentSession()

    expect(store.sharedTournaments).toHaveLength(1)
    expect(store.sharedTournaments[0]!.id).toBe(sharedTournament.id)
  })

  it('sharedTournaments — empty when no memberships', async () => {
    await mockRepositoryRef.current!.createTournament(
      makeTournament({ ownerId: OTHER_USER_ID, visibility: 'public' }),
    )

    const store = useTournamentStore()
    // Le chargement n'est plus déclenché par l'instanciation du store : on
    // le demande, comme l'accueil (gaté sur l'identité, ici déjà résolue).
    await store.loadTournamentsForCurrentSession()

    expect(store.sharedTournaments).toHaveLength(0)
  })

  it('sharedTournaments — empty when currentUserId is null', async () => {
    // Pas de session, pas d'user, pas de claims : currentUserId reste
    // null donc sharedTournaments aussi, même si la liste tournaments
    // est non vide. On crée le store APRÈS avoir nullifié les stubs
    // (les stubs ne sont pas des refs Vue réactives, donc muter leur
    // .value après création ne fire pas le watcher — pattern hérité du
    // bloc "visibility partition").
    stubSessionRef.value = null
    stubUserRef.value = null
    stubClaimsSub.value = null
    await mockRepositoryRef.current!.createTournament(
      makeTournament({ ownerId: OTHER_USER_ID, visibility: 'public' }),
    )

    const store = useTournamentStore()
    // Le chargement n'est plus déclenché par l'instanciation du store : on
    // le demande, comme l'accueil (gaté sur l'identité, ici déjà résolue).
    await store.loadTournamentsForCurrentSession()

    expect(store.sharedTournaments).toHaveLength(0)
  })

  it('publicTournaments — excludes tournaments where user is invited', async () => {
    // Un seul tournoi public d'un autre user, dont je suis membre :
    // doit apparaître dans sharedTournaments et PAS dans publicTournaments
    // (partitionnement exclusif).
    const sharedPublicTournament = makeTournament({
      name: 'Public partagé',
      ownerId: OTHER_USER_ID,
      visibility: 'public',
    })
    await mockRepositoryRef.current!.createTournament(sharedPublicTournament)
    vi.spyOn(mockRepositoryRef.current!, 'getMyMemberships').mockResolvedValue([
      makeMembership(sharedPublicTournament.id),
    ])

    const store = useTournamentStore()
    // Le chargement n'est plus déclenché par l'instanciation du store : on
    // le demande, comme l'accueil (gaté sur l'identité, ici déjà résolue).
    await store.loadTournamentsForCurrentSession()

    expect(store.sharedTournaments).toHaveLength(1)
    expect(store.publicTournaments).toHaveLength(0)
  })

  it('partitioning is mutually exclusive — owner public stays in myTournaments only', async () => {
    const ownPublic = makeTournament({
      name: 'Public perso',
      ownerId: STUB_USER_ID,
      visibility: 'public',
    })
    await mockRepositoryRef.current!.createTournament(ownPublic)
    // Cas impossible en prod (la policy DB le bloque) : un membership
    // sur son propre tournoi. La garde défensive ownerId !== userId
    // dans sharedTournaments doit l'exclure.
    vi.spyOn(mockRepositoryRef.current!, 'getMyMemberships').mockResolvedValue([
      makeMembership(ownPublic.id),
    ])

    const store = useTournamentStore()
    // Le chargement n'est plus déclenché par l'instanciation du store : on
    // le demande, comme l'accueil (gaté sur l'identité, ici déjà résolue).
    await store.loadTournamentsForCurrentSession()

    expect(store.myTournaments).toHaveLength(1)
    expect(store.myTournaments[0]!.id).toBe(ownPublic.id)
    expect(store.sharedTournaments).toHaveLength(0)
    expect(store.publicTournaments).toHaveLength(0)
  })
})

describe('useTournamentStore — invite/remove members', () => {
  it('loadTournamentMembers — populates currentTournamentMembers for the given tournament', async () => {
    const tournamentId = crypto.randomUUID()
    const member: TournamentMember = {
      id: crypto.randomUUID(),
      tournamentId,
      userId: '11111111-1111-4111-8111-111111111111',
      memberEmail: 'guest@example.com',
      createdAt: NOW,
      updatedAt: NOW,
    }
    vi.spyOn(
      mockRepositoryRef.current!,
      'getMembersByTournament',
    ).mockResolvedValue([member])

    const store = useTournamentStore()
    await flushPromises()
    await store.loadTournamentMembers(tournamentId)

    expect(store.currentTournamentMembers).toHaveLength(1)
    expect(store.currentTournamentMembers[0]!.id).toBe(member.id)
  })

  it('loadTournamentMembers — clears the previous list before fetching', async () => {
    const idA = crypto.randomUUID()
    const idB = crypto.randomUUID()
    const memberA: TournamentMember = {
      id: crypto.randomUUID(),
      tournamentId: idA,
      userId: '11111111-1111-4111-8111-111111111111',
      memberEmail: 'a@example.com',
      createdAt: NOW,
      updatedAt: NOW,
    }
    const getMembersSpy = vi
      .spyOn(mockRepositoryRef.current!, 'getMembersByTournament')
      .mockResolvedValue([memberA])

    const store = useTournamentStore()
    await flushPromises()
    await store.loadTournamentMembers(idA)
    expect(store.currentTournamentMembers).toHaveLength(1)

    // Sur une nouvelle requête (avant que la promesse ne résolve), la
    // liste est vidée immédiatement (clear-at-start sync), donc pas de
    // flash de l'ancien tournoi côté UI.
    getMembersSpy.mockResolvedValue([])
    const pendingFetch = store.loadTournamentMembers(idB)
    expect(store.currentTournamentMembers).toEqual([])
    await pendingFetch
  })

  it('loadTournamentMembers — ignores stale response when a newer request started', async () => {
    const idA = crypto.randomUUID()
    const idB = crypto.randomUUID()
    const memberA: TournamentMember = {
      id: crypto.randomUUID(),
      tournamentId: idA,
      userId: '11111111-1111-4111-8111-111111111111',
      memberEmail: 'a@example.com',
      createdAt: NOW,
      updatedAt: NOW,
    }
    const memberB: TournamentMember = {
      id: crypto.randomUUID(),
      tournamentId: idB,
      userId: '22222222-2222-4222-8222-222222222222',
      memberEmail: 'b@example.com',
      createdAt: NOW,
      updatedAt: NOW,
    }
    const resolvers: Array<(value: TournamentMember[]) => void> = []
    vi.spyOn(
      mockRepositoryRef.current!,
      'getMembersByTournament',
    ).mockImplementation(
      () =>
        new Promise<TournamentMember[]>((resolve) => {
          resolvers.push(resolve)
        }),
    )

    const store = useTournamentStore()
    await flushPromises()

    const firstCall = store.loadTournamentMembers(idA)
    const secondCall = store.loadTournamentMembers(idB)

    // Résolution INVERSE : la 2e (newer) répond avant la 1re (stale).
    resolvers[1]!([memberB])
    await secondCall
    expect(store.currentTournamentMembers.map(m => m.id)).toEqual([memberB.id])

    // La réponse tardive de la 1re ne doit ni écraser ni complèter.
    resolvers[0]!([memberA])
    await firstCall
    expect(store.currentTournamentMembers.map(m => m.id)).toEqual([memberB.id])
  })

  it('inviteMemberByDisplayName — appends to currentTournamentMembers when current modal matches the invited tournament', async () => {
    const store = useTournamentStore()
    await flushPromises()
    const created = await store.createTournament({
      name: 'Tournoi avec invités',
      date: NOW,
      format: 'round_robin',
    })
    await store.loadTournamentMembers(created.id)
    expect(store.currentTournamentMembers).toHaveLength(0)

    const invited = await store.inviteMemberByDisplayName(created.id, 'Bob')

    expect(store.currentTournamentMembers).toHaveLength(1)
    expect(store.currentTournamentMembers[0]!.id).toBe(invited.id)
    expect(store.currentTournamentMembers[0]!.memberEmail).toBe('bob@example.com')
  })

  it('inviteMemberByDisplayName — does NOT append when current modal targets a different tournament', async () => {
    const store = useTournamentStore()
    await flushPromises()
    const tournamentA = await store.createTournament({
      name: 'A',
      date: NOW,
      format: 'round_robin',
    })
    const tournamentB = await store.createTournament({
      name: 'B',
      date: NOW,
      format: 'round_robin',
    })
    // Modal ouvert sur A, invitation déclenchée sur B (cas défensif).
    await store.loadTournamentMembers(tournamentA.id)

    await store.inviteMemberByDisplayName(tournamentB.id, 'Bob')

    // currentTournamentMembers reflète toujours A (vide), pas B.
    expect(store.currentTournamentMembers).toHaveLength(0)
  })

  it('inviteMemberByDisplayName — propagates InviteMemberError with code "display_name_not_found"', async () => {
    const store = useTournamentStore()
    await flushPromises()
    const created = await store.createTournament({
      name: 'Tournoi',
      date: NOW,
      format: 'round_robin',
    })
    await store.loadTournamentMembers(created.id)

    let caught: unknown = null
    try {
      await store.inviteMemberByDisplayName(created.id, 'NotFoundUser')
    }
    catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(InviteMemberError)
    expect((caught as InviteMemberError).code).toBe('display_name_not_found')
    expect(store.currentTournamentMembers).toHaveLength(0)
  })

  it('inviteMemberByDisplayName — propagates InviteMemberError with code "already_member"', async () => {
    const store = useTournamentStore()
    await flushPromises()
    const created = await store.createTournament({
      name: 'Tournoi',
      date: NOW,
      format: 'round_robin',
    })
    await store.loadTournamentMembers(created.id)
    await store.inviteMemberByDisplayName(created.id, 'Bob')

    let caught: unknown = null
    try {
      await store.inviteMemberByDisplayName(created.id, 'Bob')
    }
    catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(InviteMemberError)
    expect((caught as InviteMemberError).code).toBe('already_member')
    // Pas de double-append.
    expect(store.currentTournamentMembers).toHaveLength(1)
  })

  it('inviteMemberByDisplayName — propagates InviteMemberError with code "self_invite"', async () => {
    const store = useTournamentStore()
    await flushPromises()
    const created = await store.createTournament({
      name: 'Tournoi',
      date: NOW,
      format: 'round_robin',
    })
    await store.loadTournamentMembers(created.id)

    let caught: unknown = null
    try {
      await store.inviteMemberByDisplayName(created.id, 'SelfInviteUser')
    }
    catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(InviteMemberError)
    expect((caught as InviteMemberError).code).toBe('self_invite')
  })

  it('removeMember — removes the member from currentTournamentMembers', async () => {
    const store = useTournamentStore()
    await flushPromises()
    const created = await store.createTournament({
      name: 'Tournoi',
      date: NOW,
      format: 'round_robin',
    })
    await store.loadTournamentMembers(created.id)
    const invited = await store.inviteMemberByDisplayName(created.id, 'Bob')
    expect(store.currentTournamentMembers).toHaveLength(1)

    await store.removeMember(invited.id)

    expect(store.currentTournamentMembers).toHaveLength(0)
  })

  it('removeMember — no-op on currentTournamentMembers when the member id is not in the current list', async () => {
    const store = useTournamentStore()
    await flushPromises()
    const created = await store.createTournament({
      name: 'Tournoi',
      date: NOW,
      format: 'round_robin',
    })
    await store.loadTournamentMembers(created.id)
    await store.inviteMemberByDisplayName(created.id, 'Bob')

    await store.removeMember('00000000-0000-4000-8000-000000000000')

    // La liste courante n'a pas perdu son membre — le DELETE repo s'est
    // exécuté sur un id inconnu (no-op côté mock) sans perturber l'état
    // local.
    expect(store.currentTournamentMembers).toHaveLength(1)
  })

  it('removeMember — propagates InviteMemberError("member_in_team") when the member is in a team', async () => {
    const store = useTournamentStore()
    await flushPromises()
    const created = await store.createTournament({
      name: 'Tournoi',
      date: NOW,
      format: 'round_robin',
    })
    await store.loadTournament(created.id)
    await store.loadTournamentMembers(created.id)
    const invited = await store.inviteMemberByDisplayName(created.id, 'Bob')
    // Bob est ajouté à une équipe en tant que joueur lié à son compte.
    await store.addTeam({
      name: 'Les Boulistes',
      players: [{ userId: invited.userId, displayName: 'Bob' }],
    })

    let caught: unknown = null
    try {
      await store.removeMember(invited.id)
    }
    catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(InviteMemberError)
    expect((caught as InviteMemberError).code).toBe('member_in_team')
    // Le membre n'a pas été retiré.
    expect(store.currentTournamentMembers).toHaveLength(1)
  })
})

describe('useTournamentStore — loadTournamentsForCurrentSession', () => {
  // La résolution d'identité vit dans le store identity (cf.
  // tests/unit/store-identity.test.ts) ; ici on ne teste que le contrat du
  // chargement gaté : no-op sans identité, une seule requête par user
  // (dédup en vol + idempotence), refetch après changement de compte.
  it('is a no-op without identity, then loads exactly once for the resolved user (in-flight dedup + idempotence)', async () => {
    // Session présente mais identité irrésoluble (user null, claims sans sub).
    stubUserRef.value = null
    stubClaimsSub.value = null
    await mockRepositoryRef.current!.createTournament(
      makeTournament({ name: 'Mine', ownerId: STUB_USER_ID }),
    )
    const repoSpy = vi.spyOn(mockRepositoryRef.current!, 'getAllTournaments')

    const identityStore = useIdentityStore()
    const store = useTournamentStore()
    await flushPromises()
    expect(identityStore.currentUserId).toBeNull()

    await store.loadTournamentsForCurrentSession()
    expect(repoSpy).not.toHaveBeenCalled()
    expect(store.hasFetchedTournaments).toBe(false)

    // L'identité arrive (chemin chaud) : deux demandes concurrentes — une
    // seule requête ; une troisième après coup — toujours une seule.
    stubUserRef.value = { sub: STUB_USER_ID }
    await identityStore.resolveForCurrentSession()
    await Promise.all([
      store.loadTournamentsForCurrentSession(),
      store.loadTournamentsForCurrentSession(),
    ])
    await store.loadTournamentsForCurrentSession()

    expect(repoSpy).toHaveBeenCalledTimes(1)
    expect(store.hasFetchedTournaments).toBe(true)
    expect(store.myTournaments).toHaveLength(1)
  })

  it('refetches tournaments after the resolved identity changes (account switch)', async () => {
    const USER_B = '11111111-1111-4111-8111-111111111111'
    await mockRepositoryRef.current!.createTournament(
      makeTournament({ name: 'Tournoi de A', ownerId: STUB_USER_ID }),
    )
    const repoSpy = vi.spyOn(mockRepositoryRef.current!, 'getAllTournaments')

    const identityStore = useIdentityStore()
    const store = useTournamentStore()
    await store.loadTournamentsForCurrentSession()
    expect(repoSpy).toHaveBeenCalledTimes(1)

    // Bascule d'identité : les stubs sont des POJO non réactifs, seule
    // resolveForCurrentSession écrit resolvedUserId (ref réactive).
    stubUserRef.value = { sub: USER_B }
    stubClaimsSub.value = USER_B
    await identityStore.resolveForCurrentSession()
    await mockRepositoryRef.current!.createTournament(
      makeTournament({ name: 'Tournoi de B', ownerId: USER_B }),
    )

    await store.loadTournamentsForCurrentSession()

    // La garde d'idempotence (loadedForUserId === sub) n'a pas court-circuité,
    // car le sub a changé (en prod c'est RLS qui filtre ; le mock sert tout).
    expect(repoSpy).toHaveBeenCalledTimes(2)
    expect(store.tournaments.map(tournament => tournament.name).sort()).toEqual([
      'Tournoi de A',
      'Tournoi de B',
    ])
  })
})

describe('useTournamentStore — setTournamentVisibility without the list', () => {
  it('falls back on the current tournament when the list is not loaded (deep link)', async () => {
    const tournament = makeTournament({ name: 'Lien profond', visibility: 'private' })
    await mockRepositoryRef.current!.createTournament(tournament)

    const store = useTournamentStore()
    // La page tournoi ne charge que le détail : la liste reste vide.
    await store.loadTournament(tournament.id)
    expect(store.tournaments).toHaveLength(0)

    await store.setTournamentVisibility(tournament.id, 'public')

    expect(store.currentTournament?.visibility).toBe('public')
    const persisted = await mockRepositoryRef.current!.getTournamentById(tournament.id)
    expect(persisted?.visibility).toBe('public')
  })
})
