// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  ssr: false,
  devtools: { enabled: true },
  modules: ["@nuxt/ui", "@nuxt/eslint", "@pinia/nuxt", "@nuxtjs/supabase"],
  css: ["~/assets/css/main.css"],
  supabase: {
    redirect: false,
  },
  typescript: {
    strict: true,
    typeCheck: true,
  },
});
