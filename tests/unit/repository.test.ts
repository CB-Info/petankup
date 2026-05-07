import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalStorageRepository } from '../../app/repositories/LocalStorageRepository'
import { createRepository } from '../../app/repositories'
import type { Match, Team, Tournament } from '../../app/types'

const NOW = '2026-01-01T00:00:00.000Z'

function makeTournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: crypto.randomUUID(),
    name: 'Tournoi de test',
    date: NOW,
    format: 'round_robin',
    status: 'draft',
    ownerId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: crypto.randomUUID(),
    tournamentId: 'unknown',
    name: 'Équipe de test',
    players: ['Alice'],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeMatch(overrides: Partial<Match> = {}): Match {
  return {
    id: crypto.randomUUID(),
    tournamentId: 'unknown',
    teamAId: 'team-a',
    teamBId: 'team-b',
    scoreA: null,
    scoreB: null,
    winnerId: null,
    status: 'pending',
    roundNumber: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

beforeEach(() => {
  if (typeof localStorage !== 'undefined') {
    localStorage.clear()
  }
})

describe('LocalStorageRepository — tournaments', () => {
  it('saves multiple tournaments and retrieves them all', async () => {
    const repository = new LocalStorageRepository()
    const firstTournament = makeTournament({ name: 'Premier tournoi' })
    const secondTournament = makeTournament({ name: 'Deuxième tournoi' })

    await repository.saveTournament(firstTournament)
    await repository.saveTournament(secondTournament)

    const allTournaments = await repository.getAllTournaments()
    expect(allTournaments).toHaveLength(2)
    expect(allTournaments.map(tournament => tournament.name).sort()).toEqual([
      'Deuxième tournoi',
      'Premier tournoi',
    ])
  })

  it('upserts when saving a tournament with an existing id', async () => {
    const repository = new LocalStorageRepository()
    const tournament = makeTournament({ name: 'Original' })

    await repository.saveTournament(tournament)
    await repository.saveTournament({ ...tournament, name: 'Renommé' })

    const allTournaments = await repository.getAllTournaments()
    expect(allTournaments).toHaveLength(1)
    expect(allTournaments[0]!.name).toBe('Renommé')
  })

  it('finds a tournament by its id', async () => {
    const repository = new LocalStorageRepository()
    const tournament = makeTournament()
    await repository.saveTournament(tournament)

    expect(await repository.getTournamentById(tournament.id)).toEqual(tournament)
  })

  it('returns undefined when looking up an unknown tournament id', async () => {
    const repository = new LocalStorageRepository()
    expect(await repository.getTournamentById('does-not-exist')).toBeUndefined()
  })

  it('cascades delete: removes the tournament, its teams and its matches', async () => {
    const repository = new LocalStorageRepository()
    const tournamentToDelete = makeTournament()
    const tournamentToKeep = makeTournament()
    await repository.saveTournament(tournamentToDelete)
    await repository.saveTournament(tournamentToKeep)

    const teamInDeleted = makeTeam({ tournamentId: tournamentToDelete.id })
    const teamInKept = makeTeam({ tournamentId: tournamentToKeep.id })
    await repository.saveTeam(teamInDeleted)
    await repository.saveTeam(teamInKept)

    const matchInDeleted = makeMatch({ tournamentId: tournamentToDelete.id })
    const matchInKept = makeMatch({ tournamentId: tournamentToKeep.id })
    await repository.saveMatch(matchInDeleted)
    await repository.saveMatch(matchInKept)

    await repository.deleteTournament(tournamentToDelete.id)

    expect(await repository.getAllTournaments()).toEqual([tournamentToKeep])
    expect(await repository.getTeamsByTournament(tournamentToDelete.id)).toEqual([])
    expect(await repository.getTeamsByTournament(tournamentToKeep.id)).toEqual([teamInKept])
    expect(await repository.getMatchesByTournament(tournamentToDelete.id)).toEqual([])
    expect(await repository.getMatchesByTournament(tournamentToKeep.id)).toEqual([matchInKept])
  })
})

describe('LocalStorageRepository — teams', () => {
  it('filters teams by tournamentId', async () => {
    const repository = new LocalStorageRepository()
    const teamInFirstTournament = makeTeam({ tournamentId: 't1' })
    const otherTeamInFirstTournament = makeTeam({ tournamentId: 't1' })
    const teamInSecondTournament = makeTeam({ tournamentId: 't2' })

    await repository.saveTeam(teamInFirstTournament)
    await repository.saveTeam(otherTeamInFirstTournament)
    await repository.saveTeam(teamInSecondTournament)

    expect(await repository.getTeamsByTournament('t1')).toHaveLength(2)
    expect(await repository.getTeamsByTournament('t2')).toHaveLength(1)
    expect(await repository.getTeamsByTournament('unknown')).toEqual([])
  })

  it('upserts when saving a team with an existing id', async () => {
    const repository = new LocalStorageRepository()
    const team = makeTeam({ tournamentId: 't1', name: 'Originale' })

    await repository.saveTeam(team)
    await repository.saveTeam({ ...team, name: 'Renommée' })

    const teamsInTournament = await repository.getTeamsByTournament('t1')
    expect(teamsInTournament).toHaveLength(1)
    expect(teamsInTournament[0]!.name).toBe('Renommée')
  })

  it('cascades delete: removes the team and its matches, keeps unrelated matches', async () => {
    const repository = new LocalStorageRepository()
    const teamToDelete = makeTeam({ tournamentId: 't1' })
    const otherTeam = makeTeam({ tournamentId: 't1' })
    await repository.saveTeam(teamToDelete)
    await repository.saveTeam(otherTeam)

    const matchWhereTeamIsA = makeMatch({
      tournamentId: 't1',
      teamAId: teamToDelete.id,
      teamBId: otherTeam.id,
    })
    const matchWhereTeamIsB = makeMatch({
      tournamentId: 't1',
      teamAId: otherTeam.id,
      teamBId: teamToDelete.id,
    })
    const unrelatedMatch = makeMatch({
      tournamentId: 't1',
      teamAId: 'someone-else',
      teamBId: 'another-team',
    })
    await repository.saveMatch(matchWhereTeamIsA)
    await repository.saveMatch(matchWhereTeamIsB)
    await repository.saveMatch(unrelatedMatch)

    await repository.deleteTeam(teamToDelete.id)

    expect(await repository.getTeamsByTournament('t1')).toEqual([otherTeam])
    expect(await repository.getMatchesByTournament('t1')).toEqual([unrelatedMatch])
  })
})

describe('LocalStorageRepository — matches', () => {
  it('filters matches by tournamentId', async () => {
    const repository = new LocalStorageRepository()
    const matchInFirstTournament = makeMatch({ tournamentId: 't1' })
    const matchInSecondTournament = makeMatch({ tournamentId: 't2' })

    await repository.saveMatch(matchInFirstTournament)
    await repository.saveMatch(matchInSecondTournament)

    expect(await repository.getMatchesByTournament('t1')).toEqual([matchInFirstTournament])
    expect(await repository.getMatchesByTournament('t2')).toEqual([matchInSecondTournament])
  })

  it('upserts when saving a match with an existing id (e.g. recording a score)', async () => {
    const repository = new LocalStorageRepository()
    const pendingMatch = makeMatch({ tournamentId: 't1' })

    await repository.saveMatch(pendingMatch)
    await repository.saveMatch({
      ...pendingMatch,
      scoreA: 13,
      scoreB: 7,
      status: 'completed',
      winnerId: pendingMatch.teamAId,
    })

    const matches = await repository.getMatchesByTournament('t1')
    expect(matches).toHaveLength(1)
    expect(matches[0]!.scoreA).toBe(13)
    expect(matches[0]!.status).toBe('completed')
  })

  it('saves a batch of 6 matches in a single call', async () => {
    const repository = new LocalStorageRepository()
    const batchOfMatches = Array.from({ length: 6 }, () =>
      makeMatch({ tournamentId: 't1' }),
    )

    await repository.saveMatches(batchOfMatches)

    expect(await repository.getMatchesByTournament('t1')).toHaveLength(6)
  })

  it('saveMatches batch upserts existing matches and appends new ones', async () => {
    const repository = new LocalStorageRepository()
    const existingMatch = makeMatch({ tournamentId: 't1', roundNumber: 1 })
    await repository.saveMatch(existingMatch)

    const updatedExistingMatch: Match = { ...existingMatch, roundNumber: 2 }
    const newMatch = makeMatch({ tournamentId: 't1', roundNumber: 1 })
    await repository.saveMatches([updatedExistingMatch, newMatch])

    const matches = await repository.getMatchesByTournament('t1')
    expect(matches).toHaveLength(2)
    expect(matches.find(match => match.id === existingMatch.id)!.roundNumber).toBe(2)
    expect(matches.find(match => match.id === newMatch.id)).toBeDefined()
  })
})

describe('createRepository', () => {
  it('returns a LocalStorageRepository instance', () => {
    expect(createRepository()).toBeInstanceOf(LocalStorageRepository)
  })
})

describe('LocalStorageRepository — when localStorage is unavailable', () => {
  beforeEach(() => {
    // Simule un contexte où `localStorage` n'existe pas (SSR, worker…).
    // `typeof localStorage` renverra alors `'undefined'` côté impl.
    vi.stubGlobal('localStorage', undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns empty results from read methods without throwing', async () => {
    const repository = new LocalStorageRepository()
    expect(await repository.getAllTournaments()).toEqual([])
    expect(await repository.getTeamsByTournament('t1')).toEqual([])
    expect(await repository.getMatchesByTournament('t1')).toEqual([])
    expect(await repository.getTournamentById('any')).toBeUndefined()
  })

  it('does not throw from save methods', async () => {
    const repository = new LocalStorageRepository()
    await expect(repository.saveTournament(makeTournament())).resolves.toBeUndefined()
    await expect(repository.saveTeam(makeTeam())).resolves.toBeUndefined()
    await expect(repository.saveMatch(makeMatch())).resolves.toBeUndefined()
    await expect(repository.saveMatches([makeMatch()])).resolves.toBeUndefined()
  })

  it('does not throw from delete methods', async () => {
    const repository = new LocalStorageRepository()
    await expect(repository.deleteTournament('any')).resolves.toBeUndefined()
    await expect(repository.deleteTeam('any')).resolves.toBeUndefined()
  })
})
