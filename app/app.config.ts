// Mappe les alias sémantiques Nuxt UI sur nos rampes custom du thème
// « Nuit & Corail » (définies dans assets/css/main.css) :
//   primary = clay (corail), secondary = gold (doré),
//   success = green, error = danger.
// Pour `neutral`, on garde `stone` (palette Tailwind chaude par défaut),
// le plus proche des neutres chauds de la charte sans maintenir une rampe
// custom 50→950 de plus.
export default defineAppConfig({
  ui: {
    colors: {
      primary: 'clay',
      secondary: 'gold',
      success: 'green',
      error: 'danger',
      neutral: 'stone',
    },
  },
})
