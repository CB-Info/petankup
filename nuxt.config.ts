// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  ssr: false,
  devtools: { enabled: true },
  modules: ["@nuxt/ui", "@nuxt/eslint", "@pinia/nuxt", "@nuxtjs/supabase"],
  css: ["~/assets/css/main.css"],
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
