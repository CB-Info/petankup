import { onTestFinished } from 'vitest'
import type { TournamentRepository } from '../../app/repositories/TournamentRepository'

// Fabrique unique des faux dépôts des tests de store.
//
// Règle : toute méthode appelée sans avoir été configurée par le test échoue
// bruyamment — jamais de valeur par défaut silencieuse. Deux chemins de store
// avalent les erreurs du dépôt (loadProfilesByIds → console.warn,
// refreshUserProfile → false) : là, l'exception seule passerait inaperçue.
// Chaque appel non configuré est donc aussi enregistré, et la fabrique arme
// elle-même, à la fin du test courant, la vérification qui fait échouer le
// test — rien à appeler dans les fichiers de tests, rien à oublier. Les
// appels doivent être attendus dans le test (flushPromises) : un appel qui
// arriverait après la fin du test serait attribué au suivant.
//
// La liste des méthodes est explicite et typée TournamentRepository : le
// compilateur la compare à l'interface. Une méthode ajoutée à l'interface
// n'est à décrire qu'ici (le contrôle de types le réclame) ; une méthode
// retirée ou renommée est signalée de la même façon. Les signatures, elles,
// sont vérifiées là où un test fournit une implémentation (paramètre
// `configured` typé sur l'interface) — un stub qui lève accepte n'importe
// quels arguments.

type RepositoryMethodName = keyof TournamentRepository

// Appels de méthodes non configurées, enregistrés jusqu'à la fin du test
// courant.
const unconfiguredCalls: RepositoryMethodName[] = []
let guardArmedForCurrentTest = false

function unconfigured(methodName: RepositoryMethodName): () => Promise<never> {
  return async () => {
    unconfiguredCalls.push(methodName)
    throw new Error(
      `Repository method "${methodName}" was called but this test did not configure it`,
    )
  }
}

const UNCONFIGURED_REPOSITORY: TournamentRepository = {
  getAllTournaments: unconfigured('getAllTournaments'),
  getTournamentById: unconfigured('getTournamentById'),
  createTournament: unconfigured('createTournament'),
  updateTournament: unconfigured('updateTournament'),
  deleteTournament: unconfigured('deleteTournament'),
  startTournament: unconfigured('startTournament'),

  getTeamsByTournament: unconfigured('getTeamsByTournament'),
  createTeam: unconfigured('createTeam'),
  updateTeam: unconfigured('updateTeam'),
  deleteTeam: unconfigured('deleteTeam'),

  getMatchesByTournament: unconfigured('getMatchesByTournament'),
  updateMatch: unconfigured('updateMatch'),

  getMembersByTournament: unconfigured('getMembersByTournament'),
  getMyMemberships: unconfigured('getMyMemberships'),
  inviteMemberByDisplayName: unconfigured('inviteMemberByDisplayName'),
  removeMember: unconfigured('removeMember'),

  getMyProfile: unconfigured('getMyProfile'),
  getProfilesByIds: unconfigured('getProfilesByIds'),
  updateMyProfile: unconfigured('updateMyProfile'),
  updateMyProfileVisibility: unconfigured('updateMyProfileVisibility'),
  getUserProfile: unconfigured('getUserProfile'),

  getFreeMatchById: unconfigured('getFreeMatchById'),
  createFreeMatch: unconfigured('createFreeMatch'),
  deleteFreeMatch: unconfigured('deleteFreeMatch'),
  findAccountByDisplayName: unconfigured('findAccountByDisplayName'),

  getFriendships: unconfigured('getFriendships'),
  requestFriendship: unconfigured('requestFriendship'),
  acceptFriendship: unconfigured('acceptFriendship'),
  refuseFriendship: unconfigured('refuseFriendship'),
  cancelFriendshipRequest: unconfigured('cancelFriendshipRequest'),
  removeFriendship: unconfigured('removeFriendship'),
}

// Vide le registre et rend les noms enregistrés, sans doublon.
function drainUnconfiguredCalls(): RepositoryMethodName[] {
  const methodNames = [...new Set(unconfiguredCalls)]
  unconfiguredCalls.length = 0
  return methodNames
}

// Échoue si une méthode non configurée a été appelée depuis la dernière
// vérification — même quand le store a avalé l'exception. Armée par la
// fabrique à la fin de chaque test ; exportée pour être testée.
export function assertNoUnconfiguredRepositoryCalls(): void {
  const methodNames = drainUnconfiguredCalls()
  if (methodNames.length > 0) {
    throw new Error(
      `Unconfigured repository methods were called: ${methodNames.join(', ')}`,
    )
  }
}

// Une seule vérification par test, quel que soit le nombre de faux dépôts
// créés (beforeEach puis test, par exemple).
function armGuardForCurrentTest(): void {
  if (guardArmedForCurrentTest) return
  guardArmedForCurrentTest = true
  onTestFinished(() => {
    guardArmedForCurrentTest = false
    assertNoUnconfiguredRepositoryCalls()
  })
}

// Un faux dépôt complet où seules les méthodes fournies répondent ; toutes
// les autres échouent bruyamment. Une entrée `undefined` est ignorée (la
// méthode reste non configurée) : un test peut passer une surcharge
// optionnelle telle quelle, sans risquer de remplacer la méthode par
// `undefined` — ce qui donnerait un TypeError muet au lieu de l'erreur
// enregistrée. À appeler dans un beforeEach ou un test (le garde s'arme sur
// le test courant).
export function createRepositoryDouble(
  configured: Partial<TournamentRepository> = {},
): TournamentRepository {
  armGuardForCurrentTest()
  const double: TournamentRepository = { ...UNCONFIGURED_REPOSITORY }
  // Le même objet, vu « par nom de méthode » : TypeScript ne relie pas la
  // clé et la valeur d'un Partial parcouru dynamiquement. Sûr : clé et
  // valeur viennent toutes deux de `configured`, typé sur l'interface.
  const doubleByMethodName: Record<RepositoryMethodName, unknown> = double
  for (const methodName of Object.keys(configured) as RepositoryMethodName[]) {
    const method = configured[methodName]
    if (method !== undefined) doubleByMethodName[methodName] = method
  }
  return double
}
