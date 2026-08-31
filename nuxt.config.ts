// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  ssr: false,
  devtools: { enabled: true },
  modules: ["@nuxt/ui", "@nuxt/eslint", "@pinia/nuxt", "@nuxtjs/supabase"],
  css: ["~/assets/css/main.css"],
  ui: {
    // Mode clair forcé : désactive l'intégration @nuxtjs/color-mode (qui reste
    // embarquée par @nuxt/ui, mais n'agit plus). <html> ne reçoit jamais la
    // classe `.dark`, aucune bascule possible, immunisé contre une valeur
    // `dark` éventuellement déjà persistée en localStorage.
    colorMode: false,
  },
  fonts: {
    // @nuxt/fonts est fourni par @nuxt/ui (pas de dépendance à ajouter).
    // Google provider, auto-hébergement + font-display: swap par défaut.
    // `global: true` sur Archivo et Space Grotesk : elles ne sont référencées
    // que via une custom prop @theme (font-disp / font-num), donc on force
    // l'injection @font-face sans dépendre du scan d'usage. Hanken Grotesk est
    // la police de corps (--font-sans) → détectée nativement.
    families: [
      { name: "Archivo", provider: "google", weights: [500, 600, 700, 800, 900], global: true },
      { name: "Hanken Grotesk", provider: "google", weights: [400, 500, 600, 700] },
      { name: "Space Grotesk", provider: "google", weights: [400, 500, 600, 700], global: true },
    ],
  },
  supabase: {
    // SPA pur : on évite le storage par cookies de @supabase/ssr (qui
    // écrit le verifier PKCE avec une path scope = path courant, donc
    // /login écrit un cookie illisible depuis /confirm). Sans
    // useSsrCookies, le SDK retombe sur localStorage (scopé origine).
    // Mais createClient sans override force flowType: 'implicit' → on
    // override explicitement pour conserver PKCE.
    //
    // Les autres options Supabase (redirect, redirectOptions.login,
    // redirectOptions.callback, redirectOptions.exclude) sont laissées
    // implicites : leurs defaults (true, '/login', '/confirm', []) matchent
    // exactement notre conf.
    useSsrCookies: false,
    clientOptions: {
      auth: {
        flowType: "pkce",
      },
    },
  },
  typescript: {
    strict: true,
    typeCheck: true,
  },
});
