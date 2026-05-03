// Mappe les alias sémantiques Nuxt UI sur nos rampes custom.
// Les rampes `horizon` et `sand` sont définies dans assets/css/main.css.
// Pour `neutral`, on prend `stone` (palette Tailwind chaude par défaut)
// : c'est le plus proche des neutres chauds de la charte (#FAFAF6 / #2C2A25)
// sans avoir à maintenir une 3e rampe custom 50→950.
export default defineAppConfig({
  ui: {
    colors: {
      primary: 'horizon',
      secondary: 'sand',
      neutral: 'stone',
    },
    icons: {
      light: 'i-lucide-sun',
      dark: 'i-lucide-moon',
    },
  },
})
