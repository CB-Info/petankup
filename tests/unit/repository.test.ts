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
    round: 1,
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
  it('saves multiple tournaments and retrieves them all', () => {
    const repository = new LocalStorageRepository()
    const firstTournament = makeTournament({ name: 'Premier tournoi' })
    const secondTournament = makeTournament({ name: 'Deuxième tournoi' })

    repository.saveTournament(firstTournament)
    repository.saveTournament(secondTournament)

    const allTournaments = repository.getAllTournaments()
    expect(allTournaments).toHaveLength(2)
    expect(allTournaments.map(tournament => tournament.name).sort()).toEqual([
      'Deuxième tournoi',
      'Premier tournoi',
    ])
  })

  it('upserts when saving a tournament with an existing id', () => {
    const repository = new LocalStorageRepository()
    const tournament = makeTournament({ name: 'Original' })

    repository.saveTournament(tournament)
    repository.saveTournament({ ...tournament, name: 'Renommé' })

    const allTournaments = repository.getAllTournaments()
    expect(allTournaments).toHaveLength(1)
    expect(allTournaments[0]!.name).toBe('Renommé')
  })

  it('finds a tournament by its id', () => {
    const repository = new LocalStorageRepository()
    const tournament = makeTournament()
    repository.saveTournament(tournament)

    expect(repository.getTournamentById(tournament.id)).toEqual(tournament)
  })

  it('returns undefined when looking up an unknown tournament id', () => {
    const repository = new LocalStorageRepository()
    expect(repository.getTournamentById('does-not-exist')).toBeUndefined()
  })

  it('cascades delete: removes the tournament, its teams and its matches', () => {
    const repository = new LocalStorageRepository()
    const tournamentToDelete = makeTournament()
    const tournamentToKeep = makeTournament()
    repository.saveTournament(tournamentToDelete)
    repository.saveTournament(tournamentToKeep)

    const teamInDeleted = makeTeam({ tournamentId: tournamentToDelete.id })
    const teamInKept = makeTeam({ tournamentId: tournamentToKeep.id })
    repository.saveTeam(teamInDeleted)
    repository.saveTeam(teamInKept)

    const matchInDeleted = makeMatch({ tournamentId: tournamentToDelete.id })
    const matchInKept = makeMatch({ tournamentId: tournamentToKeep.id })
    repository.saveMatch(matchInDeleted)
    repository.saveMatch(matchInKept)

    repository.deleteTournament(tournamentToDelete.id)

    expect(repository.getAllTournaments()).toEqual([tournamentToKeep])
    expect(repository.getTeamsByTournament(tournamentToDelete.id)).toEqual([])
    expect(repository.getTeamsByTournament(tournamentToKeep.id)).toEqual([teamInKept])
    expect(repository.getMatchesByTournament(tournamentToDelete.id)).toEqual([])
    expect(repository.getMatchesByTournament(tournamentToKeep.id)).toEqual([matchInKept])
  })
})

describe('LocalStorageRepository — teams', () => {
  it('filters teams by tournamentId', () => {
    const repository = new LocalStorageRepository()
    const teamInFirstTournament = makeTeam({ tournamentId: 't1' })
    const otherTeamInFirstTournament = makeTeam({ tournamentId: 't1' })
    const teamInSecondTournament = makeTeam({ tournamentId: 't2' })

    repository.saveTeam(teamInFirstTournament)
    repository.saveTeam(otherTeamInFirstTournament)
    repository.saveTeam(teamInSecondTournament)

    expect(repository.getTeamsByTournament('t1')).toHaveLength(2)
    expect(repository.getTeamsByTournament('t2')).toHaveLength(1)
    expect(repository.getTeamsByTournament('unknown')).toEqual([])
  })

  it('upserts when saving a team with an existing id', () => {
    const repository = new LocalStorageRepository()
    const team = makeTeam({ tournamentId: 't1', name: 'Originale' })

    repository.saveTeam(team)
    repository.saveTeam({ ...team, name: 'Renommée' })

    const teamsInTournament = repository.getTeamsByTournament('t1')
    expect(teamsInTournament).toHaveLength(1)
    expect(teamsInTournament[0]!.name).toBe('Renommée')
  })

  it('cascades delete: removes the team and its matches, keeps unrelated matches', () => {
    const repository = new LocalStorageRepository()
    const teamToDelete = makeTeam({ tournamentId: 't1' })
    const otherTeam = makeTeam({ tournamentId: 't1' })
    repository.saveTeam(teamToDelete)
    repository.saveTeam(otherTeam)

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
    repository.saveMatch(matchWhereTeamIsA)
    repository.saveMatch(matchWhereTeamIsB)
    repository.saveMatch(unrelatedMatch)

    repository.deleteTeam(teamToDelete.id)

    expect(repository.getTeamsByTournament('t1')).toEqual([otherTeam])
    expect(repository.getMatchesByTournament('t1')).toEqual([unrelatedMatch])
  })
})

describe('LocalStorageRepository — matches', () => {
  it('filters matches by tournamentId', () => {
    const repository = new LocalStorageRepository()
    const matchInFirstTournament = makeMatch({ tournamentId: 't1' })
    const matchInSecondTournament = makeMatch({ tournamentId: 't2' })

    repository.saveMatch(matchInFirstTournament)
    repository.saveMatch(matchInSecondTournament)

    expect(repository.getMatchesByTournament('t1')).toEqual([matchInFirstTournament])
    expect(repository.getMatchesByTournament('t2')).toEqual([matchInSecondTournament])
  })

  it('upserts when saving a match with an existing id (e.g. recording a score)', () => {
    const repository = new LocalStorageRepository()
    const pendingMatch = makeMatch({ tournamentId: 't1' })

    repository.saveMatch(pendingMatch)
    repository.saveMatch({
      ...pendingMatch,
      scoreA: 13,
      scoreB: 7,
      status: 'completed',
      winnerId: pendingMatch.teamAId,
    })

    const matches = repository.getMatchesByTournament('t1')
    expect(matches).toHaveLength(1)
    expect(matches[0]!.scoreA).toBe(13)
    expect(matches[0]!.status).toBe('completed')
  })

  it('saves a batch of 6 matches in a single call', () => {
    const repository = new LocalStorageRepository()
    const batchOfMatches = Array.from({ length: 6 }, () =>
      makeMatch({ tournamentId: 't1' }),
    )

    repository.saveMatches(batchOfMatches)

    expect(repository.getMatchesByTournament('t1')).toHaveLength(6)
  })

  it('saveMatches batch upserts existing matches and appends new ones', () => {
    const repository = new LocalStorageRepository()
    const existingMatch = makeMatch({ tournamentId: 't1', round: 1 })
    repository.saveMatch(existingMatch)

    const updatedExistingMatch: Match = { ...existingMatch, round: 2 }
    const newMatch = makeMatch({ tournamentId: 't1', round: 1 })
    repository.saveMatches([updatedExistingMatch, newMatch])

    const matches = repository.getMatchesByTournament('t1')
    expect(matches).toHaveLength(2)
    expect(matches.find(match => match.id === existingMatch.id)!.round).toBe(2)
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

  it('returns empty results from read methods without throwing', () => {
    const repository = new LocalStorageRepository()
    expect(repository.getAllTournaments()).toEqual([])
    expect(repository.getTeamsByTournament('t1')).toEqual([])
    expect(repository.getMatchesByTournament('t1')).toEqual([])
    expect(repository.getTournamentById('any')).toBeUndefined()
  })

  it('does not throw from save methods', () => {
    const repository = new LocalStorageRepository()
    expect(() => repository.saveTournament(makeTournament())).not.toThrow()
    expect(() => repository.saveTeam(makeTeam())).not.toThrow()
    expect(() => repository.saveMatch(makeMatch())).not.toThrow()
    expect(() => repository.saveMatches([makeMatch()])).not.toThrow()
  })

  it('does not throw from delete methods', () => {
    const repository = new LocalStorageRepository()
    expect(() => repository.deleteTournament('any')).not.toThrow()
    expect(() => repository.deleteTeam('any')).not.toThrow()
  })
})
