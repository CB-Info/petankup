// Origine de navigation vers une page tournoi. Depuis H1.d, on peut arriver
// sur un tournoi depuis une entrée du journal de profil : la flèche retour
// doit alors ramener au profil d'origine — y compris après un rechargement
// (F5). D'où sessionStorage : il survit au reload et il est propre à
// l'onglet (un lien partagé s'ouvre dans un onglet neuf → stockage vide →
// repli naturel sur Accueil).
//
// Une clé PAR TOURNOI, jamais globale : ouvrir le tournoi B depuis l'accueil
// après avoir visité le tournoi A depuis un profil ne doit pas faire mentir
// la flèche de B.
//
// Fonctions simples, sans useState ni réactivité : l'origine est lue une
// fois par visite de la page tournoi, pas observée.

const STORAGE_KEY_PREFIX = "petankup:tournament-origin:";

// Seule une route interne de profil est une origine acceptable. On ne
// navigue JAMAIS vers une valeur arbitraire lue dans le stockage.
const PROFILE_PATH_PATTERN = /^\/profile\/[A-Za-z0-9-]+$/;

function storageKeyFor(tournamentId: string): string {
  return `${STORAGE_KEY_PREFIX}${tournamentId}`;
}

// Une navigation vers /tournaments/<id> ou une de ses sous-pages (ex. les
// résultats) reste DANS le contexte du tournoi : l'origine doit y survivre.
// La borne `base + '/'` évite le faux positif `/tournaments/<id>x…`. Pure.
export function pathBelongsToTournament(
  path: string,
  tournamentId: string,
): boolean {
  const tournamentBasePath = `/tournaments/${tournamentId}`;
  return (
    path === tournamentBasePath || path.startsWith(`${tournamentBasePath}/`)
  );
}

export function useTournamentOrigin() {
  // sessionStorage peut lever (navigation privée, quotas, contextes
  // restreints) : chaque accès est enveloppé, l'échec est silencieux et
  // retombe sur le comportement par défaut (flèche Accueil).

  function rememberProfileOrigin(
    tournamentId: string,
    profilePath: string,
  ): void {
    try {
      sessionStorage.setItem(storageKeyFor(tournamentId), profilePath);
    } catch {
      // Stockage indisponible : la flèche du tournoi proposera Accueil.
    }
  }

  function readProfileOrigin(tournamentId: string): string | null {
    try {
      const storedPath = sessionStorage.getItem(storageKeyFor(tournamentId));
      if (storedPath !== null && PROFILE_PATH_PATTERN.test(storedPath)) {
        return storedPath;
      }
      return null;
    } catch {
      return null;
    }
  }

  function clearOrigin(tournamentId: string): void {
    try {
      sessionStorage.removeItem(storageKeyFor(tournamentId));
    } catch {
      // Rien à nettoyer si le stockage est inaccessible.
    }
  }

  return { rememberProfileOrigin, readProfileOrigin, clearOrigin };
}
