// Origine de navigation contextuelle. Depuis H1.d on peut arriver sur un
// tournoi depuis une entrée du journal de profil, et depuis H2.c-2 sur un
// match libre : la flèche retour doit alors ramener au profil d'origine —
// y compris après un rechargement (F5). D'où sessionStorage : il survit au
// reload et il est propre à l'onglet (un lien partagé s'ouvre dans un
// onglet neuf → stockage vide → repli naturel sur Accueil).
//
// Une clé PAR CONTEXTE — le chemin de base de la page : /tournaments/<id>,
// /free-matches/<id> — jamais globale : ouvrir le tournoi B depuis
// l'accueil après avoir visité le tournoi A depuis un profil ne doit pas
// faire mentir la flèche de B. Aucun type d'entité en dur : le mécanisme
// ignore ce qu'est un tournoi ou un match libre.
//
// Transition (refactor generic-back-origin) : l'ancien préfixe
// `petankup:tournament-origin:<id>` n'est plus lu. Une origine écrite
// avant le déploiement retombe une fois sur « Accueil » — écart accepté,
// pas de shim de compatibilité (code temporaire qu'on oublierait).
//
// Fonctions simples, sans useState ni réactivité : l'origine est lue une
// fois par visite de la page du contexte, pas observée.

const STORAGE_KEY_PREFIX = "petankup:back-origin:";

// Registre des origines acceptables : uniquement des routes internes
// connues, avec leur libellé de flèche. On ne navigue JAMAIS vers une
// valeur arbitraire lue dans le stockage. Un seul endroit, extensible.
// Depuis A3, une page de profil est à la fois une origine (pour les
// tournois et matchs ouverts depuis son journal) et une base de contexte
// (sa flèche peut ramener à l'écran des amis) : les clés par contexte
// absorbent ce cumul sans collision.
const KNOWN_ORIGINS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /^\/profile\/[A-Za-z0-9-]+$/, label: "Profil" },
  { pattern: /^\/friends$/, label: "Amis" },
];

// Forme consommée par le header (cf. AppHeaderState["back"]).
export type BackOrigin = { label: string; to: string };

function storageKeyFor(contextBasePath: string): string {
  return `${STORAGE_KEY_PREFIX}${contextBasePath}`;
}

// Une navigation vers la page du contexte ou une de ses sous-pages (ex.
// les résultats d'un tournoi) reste DANS le contexte : l'origine doit y
// survivre. La borne `base + '/'` évite le faux positif `<base>x…`. Pure.
export function pathBelongsToContext(
  path: string,
  contextBasePath: string,
): boolean {
  return path === contextBasePath || path.startsWith(`${contextBasePath}/`);
}

export function useBackOrigin() {
  // sessionStorage peut lever (navigation privée, quotas, contextes
  // restreints) : chaque accès est enveloppé, l'échec est silencieux et
  // retombe sur le comportement par défaut (flèche Accueil).

  function rememberOrigin(contextBasePath: string, originPath: string): void {
    try {
      sessionStorage.setItem(storageKeyFor(contextBasePath), originPath);
    } catch {
      // Stockage indisponible : la flèche du contexte proposera Accueil.
    }
  }

  function readOrigin(contextBasePath: string): BackOrigin | null {
    try {
      const storedPath = sessionStorage.getItem(storageKeyFor(contextBasePath));
      if (storedPath === null) return null;
      const knownOrigin = KNOWN_ORIGINS.find((candidate) =>
        candidate.pattern.test(storedPath),
      );
      if (knownOrigin === undefined) return null;
      return { label: knownOrigin.label, to: storedPath };
    } catch {
      return null;
    }
  }

  function clearOrigin(contextBasePath: string): void {
    try {
      sessionStorage.removeItem(storageKeyFor(contextBasePath));
    } catch {
      // Rien à nettoyer si le stockage est inaccessible.
    }
  }

  return { rememberOrigin, readOrigin, clearOrigin };
}
